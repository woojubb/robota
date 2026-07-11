import { describe, expect, it } from 'vitest';

import { executeRemoteControlCommand } from '../remote-control-command.js';

import type {
  ICommandHostContext,
  ICommandRemoteControlAdapter,
  TRemoteControlStatus,
} from '@robota-sdk/agent-framework';

/**
 * REMOTE-008 — `/remote-control` command: a declarative trigger (enable/stop return effects) + a
 * status read over the injected `remoteControl` adapter.
 */

function ctx(status?: TRemoteControlStatus): ICommandHostContext {
  const adapter: ICommandRemoteControlAdapter | undefined =
    status === undefined ? undefined : { getStatus: () => status };
  return {
    getCommandHostAdapters: () => (adapter ? { remoteControl: adapter } : {}),
  } as unknown as ICommandHostContext;
}

describe('executeRemoteControlCommand (REMOTE-008)', () => {
  it('default (no args) requests enable via a host effect (no transport touched by the command)', () => {
    const result = executeRemoteControlCommand(ctx(), '');
    expect(result.success).toBe(true);
    expect(result.effects).toEqual([{ type: 'remote-control-enable-requested' }]);
  });

  it('`enable` / `on` also request enable', () => {
    expect(executeRemoteControlCommand(ctx(), 'enable').effects).toEqual([
      { type: 'remote-control-enable-requested' },
    ]);
    expect(executeRemoteControlCommand(ctx(), 'ON').effects).toEqual([
      { type: 'remote-control-enable-requested' },
    ]);
  });

  it('`stop` / `off` request the stop effect', () => {
    expect(executeRemoteControlCommand(ctx(), 'stop').effects).toEqual([
      { type: 'remote-control-stop-requested' },
    ]);
    expect(executeRemoteControlCommand(ctx(), 'off').effects).toEqual([
      { type: 'remote-control-stop-requested' },
    ]);
  });

  it('`status` reads the adapter and reports the awaiting-pairing URL', () => {
    const result = executeRemoteControlCommand(
      ctx({ state: 'awaiting-pairing', pairingUrl: 'https://x/#r=a&s=b' }),
      'status',
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('https://x/#r=a&s=b');
    expect(result.effects).toBeUndefined(); // status is read-only, no effect
  });

  it('`status` with no relay reports the missing-relay guidance', () => {
    const result = executeRemoteControlCommand(ctx({ state: 'no-relay' }), 'status');
    expect(result.message).toMatch(/relayUrl/);
  });

  it('`status` with no adapter reports unavailability (never throws)', () => {
    const result = executeRemoteControlCommand(ctx(), 'status');
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/not available/i);
  });

  it('an unknown argument is a usage error (no effect)', () => {
    const result = executeRemoteControlCommand(ctx(), 'frobnicate');
    expect(result.success).toBe(false);
    expect(result.effects).toBeUndefined();
  });
});
