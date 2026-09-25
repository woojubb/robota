import { afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createDevicesCommandModule } from '../devices-command-module.js';

import type { IDevicesCommandPort } from '../devices-command-port.js';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

const DEVICE_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DEVICE_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const USER = 'UUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUU';
const SIGNING = 'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS';

function fakePort(): IDevicesCommandPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    list: vi.fn(async () => {
      calls.push('list');
      return {
        userId: USER,
        devices: [
          {
            deviceId: DEVICE_A,
            name: 'laptop',
            thisDevice: true,
            holdsSigningKey: true,
            certificateExpiresAt: Date.UTC(2026, 11, 25),
          },
          {
            deviceId: DEVICE_B,
            name: 'desktop',
            thisDevice: false,
            holdsSigningKey: false,
            certificateExpiresAt: Date.UTC(2026, 11, 20),
          },
        ],
        revokedDeviceCount: 1,
        listsExpireAt: Date.UTC(2026, 8, 27),
      };
    }),
    init: vi.fn(async (options) => {
      calls.push(`init:${options.name ?? ''}`);
      return {
        ok: true as const,
        value: { userId: USER, deviceId: DEVICE_A, signingKeyId: SIGNING, keyStorage: 'OS keychain' },
      };
    }),
    recover: vi.fn(async () => {
      calls.push('recover');
      return {
        ok: true as const,
        value: {
          deviceId: DEVICE_A,
          signingKeyId: SIGNING,
          revokedSigningKeyCount: 1,
          droppedDeviceCount: 1,
        },
      };
    }),
    revoke: vi.fn(async (target) => {
      calls.push(`revoke:${target}`);
      return { ok: true as const, value: { deviceId: DEVICE_B, name: 'desktop' } };
    }),
  };
}

function handoff(enabled: boolean, onRun?: () => void): ITerminalHandoff {
  return {
    canHandoffTerminal: enabled,
    runWithTerminal: async (operation) => {
      onRun?.();
      return operation();
    },
  };
}

let session: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await session?.dispose();
  session = undefined;
});

function start(port: IDevicesCommandPort, terminal = handoff(true)): ScriptedSessionHarness {
  session = scriptedSession({
    turns: [{ text: 'unused' }],
    terminalHandoff: terminal,
    commandModules: [createDevicesCommandModule(port)],
  });
  return session;
}

describe('/devices command', () => {
  it('is operator-only: never model-invocable, and palette metadata matches the executable', () => {
    const module = createDevicesCommandModule(fakePort());
    const palette = module.commandSources?.[0]?.getCommands()[0];
    const executable = module.systemCommands?.[0];
    expect(executable?.modelInvocable).toBe(false);
    expect(palette?.modelInvocable).toBe(false);
    expect(executable?.userInvocable).toBe(true);
    expect(palette?.subcommands?.map(({ name }) => name)).toEqual([
      'list',
      'init',
      'revoke',
      'recover',
    ]);
  });

  it('lists the roster with short ids, this device, the signing-key holder and expiry', async () => {
    const port = fakePort();
    const result = await start(port).command('devices', '');
    expect(result?.success).toBe(true);
    expect(result?.message).toContain(DEVICE_A.slice(0, 10));
    expect(result?.message).not.toContain(DEVICE_A);
    expect(result?.message).toMatch(/laptop.*this device.*signing key/);
    expect(result?.message).toContain('2026-12-25');
    expect(result?.message).toContain('desktop');
    expect(result?.message).toMatch(/1 revoked/);
  });

  it('says so when this device has no identity yet', async () => {
    const port = fakePort();
    vi.mocked(port.list).mockResolvedValueOnce(undefined);
    const result = await start(port).command('devices', 'list');
    expect(result?.message).toMatch(/\/devices init/);
  });

  it('runs init, recover and revoke on the operator terminal', async () => {
    const port = fakePort();
    const runs = vi.fn();
    const harness = start(port, handoff(true, runs));
    const init = await harness.command('devices', 'init my laptop');
    expect(init?.success).toBe(true);
    expect(init?.message).toContain(DEVICE_A.slice(0, 10));
    expect(init?.message).toContain('OS keychain');
    const recover = await harness.command('devices', 'recover');
    expect(recover?.success).toBe(true);
    expect(recover?.message).toMatch(/signing key/i);
    const revoke = await harness.command('devices', `revoke ${DEVICE_B.slice(0, 8)}`);
    expect(revoke?.success).toBe(true);
    expect(revoke?.message).toContain('desktop');
    expect(port.calls).toEqual(['init:my laptop', 'recover', `revoke:${DEVICE_B.slice(0, 8)}`]);
    expect(runs).toHaveBeenCalledTimes(3);
  });

  it('reports a refusal by its reason', async () => {
    const port = fakePort();
    vi.mocked(port.recover).mockResolvedValueOnce({ ok: false, reason: 'phrase-mismatch' });
    const result = await start(port).command('devices', 'recover');
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/different identity/i);
  });

  it('refuses without an interactive terminal and never reaches the port (fail closed)', async () => {
    const port = fakePort();
    const harness = start(port, handoff(false));
    for (const args of ['init', 'recover', 'revoke abcdef']) {
      const result = await harness.command('devices', args);
      expect(result?.success).toBe(false);
      expect(result?.message).toMatch(/interactive terminal/i);
    }
    expect(port.calls).toEqual([]);
  });

  it('refuses a model invocation', async () => {
    const port = fakePort();
    const harness = start(port);
    const result = await harness.session.executeModelCommand('devices', 'init');
    expect(result?.success ?? false).toBe(false);
    expect(port.calls).toEqual([]);
  });

  it('refuses every verb from a remote surface', async () => {
    const port = fakePort();
    const harness = start(port);
    for (const args of ['', 'init', 'recover', 'revoke abcdef']) {
      const result = await harness.session.executeCommand('devices', args, 'remote');
      expect(result?.success).toBe(false);
      expect(result?.message).toMatch(/operator/i);
    }
    expect(port.calls).toEqual([]);
  });

  it('names add and join as not yet available rather than guessing', async () => {
    const port = fakePort();
    const harness = start(port);
    for (const args of ['add', 'join abc']) {
      const result = await harness.command('devices', args);
      expect(result?.success).toBe(false);
      expect(result?.message).toMatch(/not available yet/i);
    }
    expect(port.calls).toEqual([]);
  });

  it('requires a device id for revoke', async () => {
    const port = fakePort();
    const result = await start(port).command('devices', 'revoke');
    expect(result?.success).toBe(false);
    expect(result?.message).toMatch(/usage/i);
    expect(port.calls).toEqual([]);
  });

  it('reports a failure without its stack', async () => {
    const port = fakePort();
    vi.mocked(port.init).mockRejectedValueOnce(new Error('credential store unavailable'));
    const result = await start(port).command('devices', 'init');
    expect(result?.success).toBe(false);
    expect(result?.message).toContain('credential store unavailable');
  });
});
