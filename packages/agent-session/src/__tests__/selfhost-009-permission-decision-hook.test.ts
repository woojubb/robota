/**
 * SELFHOST-009 TC-03 — PermissionDecision fires from PermissionEnforcer right after
 * `evaluatePermission`, via the shared `runHooks` / `hookTypeExecutors` path, carrying the reported
 * decision. INFORMATIONAL-ONLY: fire-and-forget, so it cannot change the permission outcome.
 */

import { describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type {
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
  ITerminalOutput,
  TToolArgs,
} from '@robota-sdk/agent-core';

function makeNoopTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function makeRecordingExecutor(exitCode = 0): {
  executor: IHookTypeExecutor;
  inputs: IHookInput[];
} {
  const inputs: IHookInput[] = [];
  const executor: IHookTypeExecutor = {
    type: 'command',
    execute: vi.fn(async (_def, input: IHookInput): Promise<IHookResult> => {
      inputs.push(input);
      return { exitCode, stdout: '', stderr: exitCode === 2 ? 'denied' : '' };
    }),
  };
  return { executor, inputs };
}

const PERMISSION_DECISION_HOOK: IPermissionEnforcerOptions['config']['hooks'] = {
  PermissionDecision: [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }],
};

function makeEnforcer(
  executor: IHookTypeExecutor,
  overrides: Partial<IPermissionEnforcerOptions> = {},
): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/tmp',
    getPermissionMode: () => 'default',
    config: {
      permissions: { allow: ['Read(*)'], deny: ['Bash(*)'] },
      hooks: PERMISSION_DECISION_HOOK,
    },
    terminal: makeNoopTerminal(),
    hookTypeExecutors: [executor],
    ...overrides,
  });
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SELFHOST-009 TC-03 — PermissionDecision hook', () => {
  it('fires exactly once after evaluatePermission, carrying the reported decision (auto)', async () => {
    const { executor, inputs } = makeRecordingExecutor();
    const enforcer = makeEnforcer(executor);

    await enforcer.checkPermission('Read', { path: '/x' } as TToolArgs);
    await flushMicrotasks();

    const decisions = inputs.filter((i) => i.hook_event_name === 'PermissionDecision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.tool_name).toBe('Read');
    expect(decisions[0]!.permission_decision).toBe('auto');
  });

  it('reports a deny decision', async () => {
    const { executor, inputs } = makeRecordingExecutor();
    const enforcer = makeEnforcer(executor);

    const allowed = await enforcer.checkPermission('Bash', { command: 'ls' } as TToolArgs);
    await flushMicrotasks();

    expect(allowed).toBe(false);
    const decisions = inputs.filter((i) => i.hook_event_name === 'PermissionDecision');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.permission_decision).toBe('deny');
  });

  it('is informational-only: an exit-code-2 hook does not change the (auto) outcome', async () => {
    const { executor } = makeRecordingExecutor(2);
    const enforcer = makeEnforcer(executor);

    const allowed = await enforcer.checkPermission('Read', { path: '/x' } as TToolArgs);
    await flushMicrotasks();

    // The hook "denied", but the outcome is decided solely by evaluatePermission → still allowed.
    expect(allowed).toBe(true);
  });
});
