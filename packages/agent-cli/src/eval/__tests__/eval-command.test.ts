/**
 * SELFHOST-011 P2 — `robota eval` exit-code contract (TC-03, the CI gate).
 *
 * `runEvalCommand` returns 1 on a failing eval and 0 on a passing one. Tests inject `loadDefinition` + `runFn`
 * so no filesystem module or live provider is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runEvalCommand } from '../eval-command.js';

import type { IEvalDefinition, IMetric } from '@robota-sdk/agent-framework';
import type { IExecutionResult } from '@robota-sdk/agent-interface-transport';

function makeResult(response: string): IExecutionResult {
  return {
    response,
    history: [],
    toolSummaries: [],
    contextState: { maxTokens: 0, usedTokens: 0, usedPercentage: 0, remainingPercentage: 0 },
  };
}

const mentionsFile: IMetric = {
  name: 'mentions-file',
  score: (r) => r.response.includes('index.ts'),
};

function definition(overrides: Partial<IEvalDefinition> = {}): IEvalDefinition {
  return { name: 'demo', cases: [{ input: 'q' }], metrics: [mentionsFile], ...overrides };
}

let stdoutText = '';
let stderrText = '';

beforeEach(() => {
  stdoutText = '';
  stderrText = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutText += chunk.toString();
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderrText += chunk.toString();
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('runEvalCommand — exit-code contract (TC-03)', () => {
  it('returns 0 when every metric passes the threshold', async () => {
    const code = await runEvalCommand(['demo.mjs'], '/tmp', {
      loadDefinition: () => Promise.resolve(definition()),
      runFn: () => Promise.resolve(makeResult('see index.ts')),
    });
    expect(code).toBe(0);
    expect(stdoutText).toContain('PASS');
  });

  it('returns 1 when a metric falls below the threshold', async () => {
    const code = await runEvalCommand(['demo.mjs'], '/tmp', {
      loadDefinition: () => Promise.resolve(definition()),
      runFn: () => Promise.resolve(makeResult('nothing here')),
    });
    expect(code).toBe(1);
    expect(stdoutText).toContain('FAIL');
  });

  it('applies a --threshold override (lowered bar can flip a fail to a pass)', async () => {
    const half: IMetric = { name: 'half', score: (r) => r.response === 'ok' };
    const def = definition({ cases: [{ input: 'a' }, { input: 'b' }], metrics: [half] });
    const runFn = (input: string): Promise<IExecutionResult> =>
      Promise.resolve(makeResult(input === 'a' ? 'ok' : 'no'));
    // default threshold 1 → fail (0.5 aggregate)
    expect(
      await runEvalCommand(['demo.mjs'], '/tmp', {
        loadDefinition: () => Promise.resolve(def),
        runFn,
      }),
    ).toBe(1);
    // --threshold 0.5 → pass (0.5 aggregate ≥ 0.5)
    expect(
      await runEvalCommand(['demo.mjs', '--threshold', '0.5'], '/tmp', {
        loadDefinition: () => Promise.resolve(def),
        runFn,
      }),
    ).toBe(0);
  });

  it('returns 1 (usage on stderr) when no definition path is given', async () => {
    const code = await runEvalCommand([], '/tmp', {});
    expect(code).toBe(1);
    expect(stderrText).toContain('Usage: robota eval');
  });

  it('returns 1 when the definition cannot be loaded/validated', async () => {
    const code = await runEvalCommand(['missing.mjs'], '/tmp', {
      loadDefinition: () => Promise.reject(new Error('no such module')),
    });
    expect(code).toBe(1);
    expect(stderrText).toContain('Failed to load eval definition');
  });

  it('returns 1 when the agent run throws', async () => {
    const code = await runEvalCommand(['demo.mjs'], '/tmp', {
      loadDefinition: () => Promise.resolve(definition()),
      runFn: () => Promise.reject(new Error('provider exploded')),
    });
    expect(code).toBe(1);
    expect(stderrText).toContain('Eval run failed');
  });
});
