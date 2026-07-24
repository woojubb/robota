/**
 * CORE-025 — background/subagent permissionPolicy enforcement at PermissionEnforcer.checkPermission.
 *
 * The load-bearing case (proposal-reviewer): the policy is resolved BEFORE the session-mode gate, so
 * `deny`/`preapproved`/`inherit-allowlist` bind even when the session mode (`bypassPermissions`) would
 * `auto`-allow every tool. A prompt policy routes to the human-approval path and fail-closes with no handler.
 */

import { describe, expect, it, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type { ITerminalOutput, TToolArgs } from '@robota-sdk/agent-core';

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

// Every task runs under `bypassPermissions` — the mode that auto-allows everything. If the policy did not
// pre-empt the mode, all these calls would return `true`; that was the bypass hole CORE-025 closes.
function makeEnforcer(overrides: Partial<IPermissionEnforcerOptions> = {}): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/tmp',
    getPermissionMode: () => 'bypassPermissions',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    ...overrides,
  });
}

const ARGS: TToolArgs = { command: 'echo hi' };

describe('CORE-025 — permissionPolicy overrides the session mode', () => {
  it('`deny` blocks a tool even under bypassPermissions (the auto-branch hole)', async () => {
    const enforcer = makeEnforcer({ permissionPolicy: 'deny' });
    await expect(enforcer.checkPermission('Bash', ARGS)).resolves.toBe(false);
  });

  it('`preapproved` allows only the task-declared allowlist, denies the rest — under bypass', async () => {
    const enforcer = makeEnforcer({
      permissionPolicy: 'preapproved',
      taskPermissions: { allow: ['Read'] },
    });
    await expect(enforcer.checkPermission('Read', {})).resolves.toBe(true);
    await expect(enforcer.checkPermission('Write', {})).resolves.toBe(false);
  });

  it('`inherit-allowlist` inherits the PARENT (config) allowlist, denies a miss — under bypass', async () => {
    const enforcer = makeEnforcer({
      permissionPolicy: 'inherit-allowlist',
      config: { permissions: { allow: ['Read'], deny: [] } },
    });
    await expect(enforcer.checkPermission('Read', {})).resolves.toBe(true);
    await expect(enforcer.checkPermission('Write', {})).resolves.toBe(false);
  });

  it('a parent deny-list entry blocks even under `inherit-allowlist` + bypass (deny > allow)', async () => {
    const enforcer = makeEnforcer({
      permissionPolicy: 'inherit-allowlist',
      config: { permissions: { allow: ['Bash'], deny: ['Bash'] } },
    });
    await expect(enforcer.checkPermission('Bash', ARGS)).resolves.toBe(false);
  });

  it('`prompt` fail-closes to deny with no approval handler', async () => {
    const enforcer = makeEnforcer({ permissionPolicy: 'prompt' });
    await expect(enforcer.checkPermission('Bash', ARGS)).resolves.toBe(false);
  });

  it('`prompt` routes to the handler when one is attached', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({ permissionPolicy: 'prompt', permissionHandler: handler });
    await expect(enforcer.checkPermission('Bash', ARGS)).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith('Bash', ARGS);
  });

  it('WITHOUT a policy, bypassPermissions still auto-allows (no behavior change)', async () => {
    const enforcer = makeEnforcer();
    await expect(enforcer.checkPermission('Bash', ARGS)).resolves.toBe(true);
  });
});
