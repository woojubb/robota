import { describe, expect, it, vi } from 'vitest';

import { createDefaultRemoteCommandPolicy } from '../../commands/index.js';
import { SessionSkillRouter } from '../interactive-session-skill-router.js';

import type { ICommandHostContext, ICommandModule, ISystemCommand } from '../../commands/index.js';
import type { IRemoteCommandPolicy } from '../../commands/index.js';

/**
 * REMOTE-003 B1 — the deny-by-default gate for remote-origin (`source==='remote'`) commands lives in
 * `SessionSkillRouter.executeCommandWithSource`, before the blocking/non-blocking dispatch branch. These tests
 * drive the router directly with a stubbed command set and assert the allow/deny matrix + that a denied command's
 * `execute` is never called.
 */

function makeCommand(name: string, extra: Partial<ISystemCommand>): ISystemCommand {
  return {
    name,
    description: name,
    execute: vi.fn().mockResolvedValue({ success: true, message: `${name} ran` }),
    ...extra,
  } as ISystemCommand;
}

function makeRouter(commands: ISystemCommand[], policy?: IRemoteCommandPolicy): SessionSkillRouter {
  const module: ICommandModule = { name: 'test-module', systemCommands: commands };
  const stubSession = {} as unknown as ICommandHostContext;
  return new SessionSkillRouter(
    [module],
    '/tmp/remote-gate-test',
    undefined,
    () => stubSession,
    () => 'session-id',
    async () => {},
    async () => {},
    () => {},
    async () => '',
    async () => ({}) as never,
    (execute) => execute(),
    undefined,
    policy,
  );
}

const READ_ONLY = makeCommand('status', { safety: 'read-only', lifecycle: 'inline' });
const MUTATING = makeCommand('shell', { requiresPermission: true, lifecycle: 'inline' });
const MUTATING_BLOCKING = makeCommand('editor', {
  requiresPermission: true,
  lifecycle: 'blocking',
});
const ALLOWLISTED = makeCommand('deploy', { requiresPermission: true, lifecycle: 'inline' });

describe('SessionSkillRouter remote-command gate (REMOTE-003 B1)', () => {
  it('TC-03a: allows a read-only command from a remote origin', async () => {
    const cmd = READ_ONLY;
    const router = makeRouter([cmd]);
    const result = await router.executeCommand('status', '', 'remote');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });

  it('TC-03b: denies a non-read-only command from a remote origin without calling execute', async () => {
    const cmd = MUTATING;
    const router = makeRouter([cmd]);
    const result = await router.executeCommand('shell', '', 'remote');
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/not permitted from a remote session/);
    expect(cmd.execute).not.toHaveBeenCalled();
  });

  it('TC-05: denies a BLOCKING-lifecycle non-read-only remote command (guard sits above the blocking branch)', async () => {
    const cmd = MUTATING_BLOCKING;
    const router = makeRouter([cmd]);
    const result = await router.executeCommand('editor', '', 'remote');
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/not permitted from a remote session/);
    expect(cmd.execute).not.toHaveBeenCalled();
  });

  it('TC-04: an allowlisted non-read-only command executes from a remote origin', async () => {
    const cmd = ALLOWLISTED;
    const router = makeRouter([cmd], createDefaultRemoteCommandPolicy(['deploy']));
    const result = await router.executeCommand('deploy', '', 'remote');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });

  it('TC-06a: a non-read-only command runs unchanged from a local user origin (no gate)', async () => {
    const cmd = makeCommand('shell', { requiresPermission: true, lifecycle: 'inline' });
    const router = makeRouter([cmd]);
    const result = await router.executeCommand('shell', '', 'user');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });

  it('TC-06b: source defaults to `user` when omitted (no gate applied)', async () => {
    const cmd = makeCommand('shell', { requiresPermission: true, lifecycle: 'inline' });
    const router = makeRouter([cmd]);
    const result = await router.executeCommand('shell', '');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });
});
