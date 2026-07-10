import { describe, expect, it, vi } from 'vitest';

import { createDefaultRemoteCommandPolicy } from '../../commands/index.js';
import { SessionSkillRouter } from '../interactive-session-skill-router.js';

import type { ICommandHostContext, ICommandModule, ISystemCommand } from '../../commands/index.js';
import type { IRemoteCommandPolicy } from '../../commands/index.js';

/**
 * REMOTE-006 — local == remote. A transport-origin (`source==='remote'`) command runs exactly as a locally-typed
 * one by default (allow-by-default); the router's gate only fires when a consumer injects an OPTIONAL restrictive
 * `IRemoteCommandPolicy`. These tests drive `SessionSkillRouter` directly and assert the allow/deny matrix.
 */

/** A read-only-only restriction — the optional opt-in seam a consumer may inject. */
const RESTRICTIVE: IRemoteCommandPolicy = { isAllowed: (_name, readOnly) => readOnly };

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

function mutating(name = 'shell'): ISystemCommand {
  return makeCommand(name, { requiresPermission: true, lifecycle: 'inline' });
}

describe('SessionSkillRouter remote-command policy (REMOTE-006 — allow-by-default)', () => {
  it('TC-01: with the default allow-all policy, a non-read-only remote command executes (was denied under B1)', async () => {
    const cmd = mutating();
    const router = makeRouter([cmd], createDefaultRemoteCommandPolicy());
    const result = await router.executeCommand('shell', '', 'remote');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });

  it('TC-02: no-policy framework default — undefined policy now ALLOWS a non-read-only remote command', async () => {
    const cmd = mutating();
    const router = makeRouter([cmd]); // remoteCommandPolicy === undefined
    const result = await router.executeCommand('shell', '', 'remote');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });

  it('TC-03: the optional restriction seam still restricts — a non-read-only remote command is denied when a restrictive policy is injected', async () => {
    const cmd = mutating();
    const router = makeRouter([cmd], RESTRICTIVE);
    const result = await router.executeCommand('shell', '', 'remote');
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/not permitted by the configured remote-command policy/);
    expect(cmd.execute).not.toHaveBeenCalled();
  });

  it('TC-03: a restrictive policy still allows a read-only remote command', async () => {
    const cmd = makeCommand('status', { safety: 'read-only', lifecycle: 'inline' });
    const router = makeRouter([cmd], RESTRICTIVE);
    const result = await router.executeCommand('status', '', 'remote');
    expect(result?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });

  it('TC-03: a restrictive policy also gates the BLOCKING-lifecycle branch', async () => {
    const cmd = makeCommand('editor', { requiresPermission: true, lifecycle: 'blocking' });
    const router = makeRouter([cmd], RESTRICTIVE);
    const result = await router.executeCommand('editor', '', 'remote');
    expect(result?.success).toBe(false);
    expect(cmd.execute).not.toHaveBeenCalled();
  });

  it('TC-04: local `user` + default-omitted commands run unchanged (no gate)', async () => {
    const cmd = mutating();
    const router = makeRouter([cmd], RESTRICTIVE); // even with a restrictive policy, local is never gated
    expect((await router.executeCommand('shell', '', 'user'))?.success).toBe(true);
    expect(cmd.execute).toHaveBeenCalledTimes(1);
  });
});
