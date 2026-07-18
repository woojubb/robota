import { describe, it, expect } from 'vitest';

import { runHooks } from '../hook-runner.js';
import { GuardrailExecutor } from '../executors/guardrail-executor.js';

import type { THooksConfig, IHookInput, TGuardrail } from '../types.js';

/**
 * SELFHOST-005 TC-01 / TC-04 — a guardrail block flows through the SAME single `runHooks` blocked
 * return that command/http hooks use. There is NO second, independently-ordered enforcement tier:
 * the guardrail executor maps failure onto exit-code-2 → `runHooks` returns `{ blocked: true }`, the
 * exact denial `runPreToolHook`/`PermissionEnforcer` already propagate. Parallelism stays INSIDE the
 * executor; the turn still carries exactly one block decision.
 */

const INPUT: IHookInput = {
  session_id: 's1',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
};

function configWithGuardrail(): THooksConfig {
  return { PreToolUse: [{ matcher: '', hooks: [{ type: 'guardrail' }] }] };
}

const blockGuardrail: TGuardrail = () => ({ pass: false, reason: 'command contains a secret' });
const passGuardrail: TGuardrail = () => ({ pass: true });

describe('SELFHOST-005 TC-01/TC-04 — guardrail rides the single runHooks blocked path', () => {
  it('a failing guardrail blocks the turn via runHooks (same blocked contract as hooks)', async () => {
    const result = await runHooks(configWithGuardrail(), 'PreToolUse', INPUT, [
      new GuardrailExecutor({ secrets: blockGuardrail }),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('command contains a secret');
  });

  it('a passing guardrail does not block', async () => {
    const result = await runHooks(configWithGuardrail(), 'PreToolUse', INPUT, [
      new GuardrailExecutor({ secrets: passGuardrail }),
    ]);
    expect(result.blocked).toBe(false);
  });

  it('the guardrail block is the SAME IRunHooksResult shape as a command-hook block (no second tier)', async () => {
    const result = await runHooks(configWithGuardrail(), 'PreToolUse', INPUT, [
      new GuardrailExecutor({ secrets: blockGuardrail }),
    ]);
    // Exactly the { blocked, reason, stdout } contract — not a distinct guardrail-specific result.
    expect(Object.keys(result).sort()).toEqual(['blocked', 'reason', 'stdout']);
  });

  it('no guardrail executor registered → the guardrail hook is skipped (unknown type), turn proceeds', async () => {
    // Mirrors runHooks' unknown-type skip: without the executor, the { type: 'guardrail' } hook is a no-op.
    const result = await runHooks(configWithGuardrail(), 'PreToolUse', INPUT, []);
    expect(result.blocked).toBe(false);
  });
});
