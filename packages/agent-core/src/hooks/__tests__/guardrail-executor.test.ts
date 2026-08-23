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
  it('returns allow when every guardrail passes', async () => {
    const exec = new GuardrailExecutor({ a: pass(), b: pass() });
    const r = await exec.execute(DEF, INPUT);
    expect(r.outcome).toBe('allow');
  });

  it('returns deny with the reason when a guardrail fails', async () => {
    const exec = new GuardrailExecutor({ a: pass(), b: block('no secrets in args') });
    const r = await exec.execute(DEF, INPUT);
    expect(r.outcome).toBe('deny');
    expect(r.outcome === 'deny' && r.reason).toBe('no secrets in args');
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
    expect(r.outcome).toBe('deny');
    expect(slowFinished).toBe(false); // returned without waiting for the slow peer
  });

  it('fail-safe: a throwing guardrail blocks the turn', async () => {
    const thrower: TGuardrail = () => {
      throw new Error('cannot evaluate');
    };
    const exec = new GuardrailExecutor({ x: thrower });
    const r = await exec.execute(DEF, INPUT);
    expect(r.outcome).toBe('deny');
    expect(r.outcome === 'deny' && r.reason).toContain('cannot evaluate');
  });

  it('runs only the named subset when definition.guardrails is set', async () => {
    const exec = new GuardrailExecutor({ a: pass(), b: block('should not run') });
    const r = await exec.execute({ type: 'guardrail', guardrails: ['a'] }, INPUT);
    expect(r.outcome).toBe('allow'); // b was not selected
  });

  it('allows when no guardrails are registered', async () => {
    const exec = new GuardrailExecutor({});
    const r = await exec.execute(DEF, INPUT);
    expect(r.outcome).toBe('allow');
  });

  it('fail-safe: blocks when a NAMED guardrail is not registered (config error must not silently pass)', async () => {
    const exec = new GuardrailExecutor({ a: pass() });
    const r = await exec.execute({ type: 'guardrail', guardrails: ['a', 'missing'] }, INPUT);
    expect(r.outcome).toBe('deny');
    expect(r.outcome === 'deny' && r.reason).toContain('missing');
  });

  // SEC-015 TC-05. Asserted here rather than trusted to the decoder's own pass-through test:
  // `GuardrailExecutor` never calls `decodeHookVerdict`, so nothing else in the suite would notice
  // this executor emitting the wrong `source`. Found by the GATE-COMPLETE guard.
  it('every outcome carries source: "guardrail"', async () => {
    const allowed = await new GuardrailExecutor({ a: pass() }).execute(DEF, INPUT);
    const denied = await new GuardrailExecutor({ a: block('nope') }).execute(DEF, INPUT);
    const empty = await new GuardrailExecutor({}).execute(DEF, INPUT);
    // The unknown-named-guardrail fail-safe is a fifth stamping site and a reachable one — a config
    // error that must deny rather than silently pass. Review found the first version of this test
    // covered three of five sites while its title claimed every outcome.
    const misconfigured = await new GuardrailExecutor({ a: pass() }).execute(
      { type: 'guardrail', guardrails: ['missing'] },
      INPUT,
    );
    expect(misconfigured.outcome).toBe('deny');
    // The fifth site is the mis-dispatch guard. Unreachable through `runHooks`, which dispatches by
    // type — but `execute` is public, so a consumer can reach it, and the title above says EVERY
    // outcome. Covering it is two lines; leaving the title overclaiming is the habit this item is
    // about.
    const misdispatched = await new GuardrailExecutor({}).execute(
      { type: 'command', command: 'not mine' },
      INPUT,
    );
    expect(misdispatched.outcome).toBe('error');
    expect([
      allowed.source,
      denied.source,
      empty.source,
      misconfigured.source,
      misdispatched.source,
    ]).toEqual(['guardrail', 'guardrail', 'guardrail', 'guardrail', 'guardrail']);
  });
});
