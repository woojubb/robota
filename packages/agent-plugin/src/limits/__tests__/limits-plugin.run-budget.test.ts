import { describe, it, expect, vi } from 'vitest';
import type { IPluginExecutionContext, IPluginExecutionResult } from '@robota-sdk/agent-core';
import { PluginError, calculateModelCost } from '@robota-sdk/agent-core';

// Mock logger (mirrors limits-plugin.test.ts) so warn() is a spy we can assert.
// `vi.hoisted` so the spy exists before the hoisted vi.mock factory runs.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@robota-sdk/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      isDebugEnabled: vi.fn().mockReturnValue(false),
      setLevel: vi.fn(),
      getLevel: vi.fn().mockReturnValue('warn'),
    }),
  };
});

import { LimitsPlugin } from '../limits-plugin';

/**
 * SELFHOST-004 P4 (TC-02 / TC-04): per-run cumulative budget cap in LimitsPlugin.
 *
 * TC-02 — a per-run cumulative cap keyed by `sessionId` that NEVER time-resets, halts the next turn
 *         once exceeded, and resets via `resetLimits(sessionId)` at run start.
 * TC-04 — enforced cost uses the SAME `calculateModelCost` SSOT (exact input/output split) as the
 *         displayed `costUsd`; unpriced models accrue nothing; enforcement lives ONLY in this plugin.
 */

const MODEL = 'gpt-4o'; // priced: $2.5/M in, $10/M out
// prompt 200k + completion 100k → 0.5 + 1.0 = $1.5 per turn (via calculateModelCost).
const TURN_COST = calculateModelCost(MODEL, 200_000, 100_000)!;

function ctx(sessionId = 'run-1'): IPluginExecutionContext {
  return { sessionId, config: { model: MODEL }, messages: [] };
}

function result(): IPluginExecutionResult {
  return { success: true, usage: { promptTokens: 200_000, completionTokens: 100_000 } };
}

describe('SELFHOST-004 TC-02 — per-run cumulative budget cap', () => {
  it('accrues the exact per-turn cost across turns without time-resetting', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none', maxRunCost: 100 });
    await plugin.afterExecution(ctx(), result());
    await plugin.afterExecution(ctx(), result());
    expect(plugin.getRunCost('run-1')).toBeCloseTo(TURN_COST * 2, 6);
  });

  it('halts (throws) the next turn once the run cumulative cost exceeds the cap', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none', maxRunCost: 2 }); // cap $2, turn $1.5
    // turn 1 — under budget, beforeExecution allows, afterExecution accrues to 1.5
    await expect(plugin.beforeExecution(ctx())).resolves.toBeUndefined();
    await plugin.afterExecution(ctx(), result());
    // turn 2 — still under (1.5 < 2), allowed; accrues to 3.0 (crosses the cap → warns)
    await expect(plugin.beforeExecution(ctx())).resolves.toBeUndefined();
    await plugin.afterExecution(ctx(), result());
    expect(warn).toHaveBeenCalled();
    // turn 3 — over budget now (3.0 ≥ 2) → halts
    await expect(plugin.beforeExecution(ctx())).rejects.toBeInstanceOf(PluginError);
  });

  it('keys the budget by sessionId — separate runs accrue independently', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none', maxRunCost: 2 });
    await plugin.afterExecution(ctx('run-A'), result()); // 1.5
    await plugin.afterExecution(ctx('run-A'), result()); // 3.0 → over
    await plugin.afterExecution(ctx('run-B'), result()); // 1.5 → under

    await expect(plugin.beforeExecution(ctx('run-A'))).rejects.toBeInstanceOf(PluginError);
    await expect(plugin.beforeExecution(ctx('run-B'))).resolves.toBeUndefined();
  });

  it('resetLimits(sessionId) clears only that run and re-allows turns', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none', maxRunCost: 2 });
    await plugin.afterExecution(ctx('run-A'), result());
    await plugin.afterExecution(ctx('run-A'), result()); // over
    await expect(plugin.beforeExecution(ctx('run-A'))).rejects.toBeInstanceOf(PluginError);

    plugin.resetLimits('run-A');
    expect(plugin.getRunCost('run-A')).toBe(0);
    await expect(plugin.beforeExecution(ctx('run-A'))).resolves.toBeUndefined();
  });

  it('applies no per-run cap when maxRunCost is omitted (unbounded)', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none' });
    for (let i = 0; i < 10; i++) await plugin.afterExecution(ctx(), result());
    // no cap configured → the run cost is not even tracked; never halts
    expect(plugin.getRunCost('run-1')).toBe(0);
    await expect(plugin.beforeExecution(ctx())).resolves.toBeUndefined();
  });
});

describe('SELFHOST-004 TC-04 — enforced cost shares the display SSOT path', () => {
  it('accrues exactly calculateModelCost(model, prompt, completion) — one computation path', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none', maxRunCost: 100 });
    await plugin.afterExecution(ctx(), result());
    expect(plugin.getRunCost('run-1')).toBe(calculateModelCost(MODEL, 200_000, 100_000));
  });

  it('accrues nothing for an unpriced model (mirrors costStatus unknown)', async () => {
    const plugin = new LimitsPlugin({ strategy: 'none', maxRunCost: 100 });
    const unpricedCtx: IPluginExecutionContext = {
      sessionId: 'run-1',
      config: { model: 'no-such-model-xyz' },
      messages: [],
    };
    await plugin.afterExecution(unpricedCtx, result());
    expect(plugin.getRunCost('run-1')).toBe(0);
  });
});
