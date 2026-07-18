import { describe, it, expect } from 'vitest';

import { GuardrailExecutor } from '../executors/guardrail-executor.js';

import type { IGuardrailHookDefinition, IHookInput, TGuardrail } from '../types.js';

/**
 * SELFHOST-005 TC-02 — the guardrail executor runs its set in PARALLEL and FAILS FAST, mapping any
 * failure onto the exit-code-2 / `blocked` contract. Parallelism lives inside the executor.
 */

const INPUT: IHookInput = {
  session_id: 's1',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
};

const DEF: IGuardrailHookDefinition = { type: 'guardrail' };

function pass(): TGuardrail {
  return () => ({ pass: true });
}
function block(reason: string): TGuardrail {
  return () => ({ pass: false, reason });
}

describe('SELFHOST-005 TC-02 — GuardrailExecutor', () => {
  it('returns exit code 0 when every guardrail passes', async () => {
    const exec = new GuardrailExecutor({ a: pass(), b: pass() });
    const r = await exec.execute(DEF, INPUT);
    expect(r.exitCode).toBe(0);
  });

  it('returns exit code 2 (blocked) with the reason when a guardrail fails', async () => {
    const exec = new GuardrailExecutor({ a: pass(), b: block('no secrets in args') });
    const r = await exec.execute(DEF, INPUT);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe('no secrets in args');
  });

  it('runs guardrails in parallel (all start before any resolves)', async () => {
    let started = 0;
    let maxConcurrent = 0;
    const slow = (): TGuardrail => async () => {
      started += 1;
      maxConcurrent = Math.max(maxConcurrent, started);
      await new Promise((r) => setTimeout(r, 10));
      started -= 1;
      return { pass: true };
    };
    const exec = new GuardrailExecutor({ a: slow(), b: slow(), c: slow() });
    await exec.execute(DEF, INPUT);
    expect(maxConcurrent).toBe(3); // all three in flight at once
  });

  it('fails fast: a fast block returns before a slow peer finishes', async () => {
    let slowFinished = false;
    const slowPass: TGuardrail = async () => {
      await new Promise((r) => setTimeout(r, 50));
      slowFinished = true;
      return { pass: true };
    };
    const fastBlock: TGuardrail = async () => ({ pass: false, reason: 'fast block' });
    const exec = new GuardrailExecutor({ slow: slowPass, fast: fastBlock });

    const r = await exec.execute(DEF, INPUT);
    expect(r.exitCode).toBe(2);
    expect(slowFinished).toBe(false); // returned without waiting for the slow peer
  });

  it('fail-safe: a throwing guardrail blocks the turn', async () => {
    const thrower: TGuardrail = () => {
      throw new Error('cannot evaluate');
    };
    const exec = new GuardrailExecutor({ x: thrower });
    const r = await exec.execute(DEF, INPUT);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('cannot evaluate');
  });

  it('runs only the named subset when definition.guardrails is set', async () => {
    const exec = new GuardrailExecutor({ a: pass(), b: block('should not run') });
    const r = await exec.execute({ type: 'guardrail', guardrails: ['a'] }, INPUT);
    expect(r.exitCode).toBe(0); // b was not selected
  });

  it('passes (exit 0) when no guardrails are registered', async () => {
    const exec = new GuardrailExecutor({});
    const r = await exec.execute(DEF, INPUT);
    expect(r.exitCode).toBe(0);
  });
});
