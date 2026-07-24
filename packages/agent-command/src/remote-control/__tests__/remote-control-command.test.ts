import { describe, expect, it } from 'vitest';

import { executeRemoteControlCommand } from '../remote-control-command.js';

import type {
  ICommandHostContext,
  ICommandRemoteControlAdapter,
  TRemoteControlStatus,
} from '@robota-sdk/agent-framework';

/**
 * REMOTE-008 — `/remote-control` command: a declarative trigger (enable/stop return host actions) + a
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
    expect(result.hostActions).toEqual([{ type: 'remote-control-enable' }]);
  });

  it('`enable` / `on` also request enable', () => {
    expect(executeRemoteControlCommand(ctx(), 'enable').hostActions).toEqual([
      { type: 'remote-control-enable' },
    ]);
    expect(executeRemoteControlCommand(ctx(), 'ON').hostActions).toEqual([
      { type: 'remote-control-enable' },
    ]);
  });

  it('`stop` / `off` request the stop host action', () => {
    expect(executeRemoteControlCommand(ctx(), 'stop').hostActions).toEqual([
      { type: 'remote-control-stop' },
    ]);
    expect(executeRemoteControlCommand(ctx(), 'off').hostActions).toEqual([
      { type: 'remote-control-stop' },
    ]);
  });

  it('`status` reads the adapter and reports the awaiting-pairing URL', () => {
    const result = executeRemoteControlCommand(
      ctx({ state: 'awaiting-pairing', pairingUrl: 'https://x/#r=a&s=b' }),
      'status',
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('https://x/#r=a&s=b');
    expect(result.hostActions).toBeUndefined(); // status is read-only, no action
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
    expect(result.hostActions).toBeUndefined();
  });

  // REMOTE-012 E3 — trusted-device management verbs.
  function e3ctx(over: Partial<ICommandRemoteControlAdapter>): ICommandHostContext {
    const adapter: ICommandRemoteControlAdapter = { getStatus: () => ({ state: 'off' }), ...over };
    return {
      getCommandHostAdapters: () => ({ remoteControl: adapter }),
    } as unknown as ICommandHostContext;
  }

  it('`devices` lists enrolled trusted devices', () => {
    const result = executeRemoteControlCommand(
      e3ctx({
        listDevices: () => [
          { deviceId: 'AbC-123', label: 'phone', lastSeenAt: '2026-07-11T00:00:00Z' },
        ],
      }),
      'devices',
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('AbC-123');
    expect(result.message).toContain('phone');
  });

  it('`devices` with none enrolled says so', () => {
    const result = executeRemoteControlCommand(e3ctx({ listDevices: () => [] }), 'devices');
    expect(result.message).toMatch(/no trusted devices/i);
  });

  it('`revoke <id>` removes a device (case-preserving id) and reports it', () => {
    let revoked: string | undefined;
    const result = executeRemoteControlCommand(
      e3ctx({
        revokeDevice: (id) => {
          revoked = id;
          return true;
        },
      }),
      'revoke AbC-123',
    );
    expect(revoked).toBe('AbC-123'); // NOT lowercased
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/revoked/i);
  });

  it('`revoke` of an unknown id is a failure notice', () => {
    const result = executeRemoteControlCommand(
      e3ctx({ revokeDevice: () => false }),
      'revoke ghost',
    );
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no trusted device/i);
  });

  it('`revoke` with no id is a usage error', () => {
    const result = executeRemoteControlCommand(e3ctx({ revokeDevice: () => true }), 'revoke');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/usage/i);
  });
});
