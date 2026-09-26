/**
 * PEER-004 (#1863) — the composition step, and what it does when a capability cannot be assembled.
 *
 * The unit cases underneath prove the presence leaf and the command. This one proves they are
 * REACHED, which is the half that was missing: the rendezvous directory and the registry both landed
 * and, measured on this tree before this change, no source outside their own modules and tests called
 * either one. Layers passing separately is not the same as the path working.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { attachHostAdapters, attachLocalPeerMessaging } from '../host-action-adapters.js';

vi.mock('../../remote-control/local-peer-messaging.js', () => ({
  startLocalPeerMessaging: vi.fn(async () => ({
    socketPath: '/tmp/mock-peer.sock',
    send: async () => ({ id: 'x', sequence: 1, state: 'acknowledged' }),
    close: async () => {},
  })),
}));

import type { RemoteControlController } from '../../remote-control/index.js';
import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';

const CONTROLLER = {
  getStatus: () => ({ state: 'off' as const }),
  describeKeyStorage: () => 'OS keychain (macOS Keychain)',
  listDevices: () => [],
  revokeDevice: () => false,
  enable: () => 'on',
  stop: () => 'off',
} as unknown as RemoteControlController;

function reporter() {
  const said: string[] = [];
  return { said, writeError: (message: string) => said.push(message) };
}

describe('assembling the host adapters', () => {
  it('rebinds activity to the current channel and clears the previous observation', () => {
    vi.useFakeTimers();
    try {
      const published: Array<string | undefined> = [];
      const presence = {
        sessionId: 'self',
        guardedDirectory: '/tmp/rendezvous',
        list: () => [],
        listWithWorkspace: async () => [],
        relate: async () => undefined,
        refreshWorkspace: async () => {},
        publishStatus: (status: string | undefined) => published.push(status),
        withdraw: () => {},
      };
      const start = attachHostAdapters({}, CONTROLLER, reporter(), () => presence);
      const sessions = [0, 1].map(() => ({
        status: 'idle' as 'idle' | 'working',
        submit: async () => ({}),
        getLocalActivityStatus() {
          return this.status;
        },
      }));
      const first = { isActiveForPeerStatus: true, getSession: () => sessions[0]! as never };
      start(first);
      sessions[0]!.status = 'working';
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBe('working');
      first.isActiveForPeerStatus = false;
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBeUndefined();
      start({ isActiveForPeerStatus: true, getSession: () => sessions[1]! as never });
      expect(published.slice(-2)).toEqual([undefined, 'idle']);
      sessions[0]!.status = 'working';
      vi.advanceTimersByTime(250);
      expect(published.at(-1)).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('wires `/peers` to a presence that announced', () => {
    const adapters: ICommandHostAdapters = {};
    const report = reporter();
    const presence = {
      sessionId: 'session-one',
      guardedDirectory: '/tmp/rendezvous',
      list: () => [{ sessionId: 'session-one', liveness: 'alive' as const }],
      listWithWorkspace: async () => [],
      relate: async () => undefined,
      refreshWorkspace: async () => {},
      publishStatus: () => undefined,
      withdraw: () => undefined,
    };

    attachHostAdapters(adapters, CONTROLLER, report, () => presence);

    expect(adapters.localPeers?.ownSessionId()).toBe('session-one');
    expect(adapters.localPeers?.list()).toEqual([{ sessionId: 'session-one', liveness: 'alive' }]);
    expect(report.said).toEqual([]);
  });

  it('generates the session id here rather than taking one', () => {
    // A session id identifies THIS process for its whole life and has no other source. Asking a
    // caller for one would let two call sites disagree about what a session is, which is the exact
    // question the registry keys its entries on.
    const seen: string[] = [];
    attachHostAdapters({}, CONTROLLER, reporter(), (options) => {
      seen.push(options.sessionId);
      return {
        sessionId: options.sessionId,
        guardedDirectory: '/tmp/rendezvous',
        list: () => [],
        listWithWorkspace: async () => [],
        relate: async () => undefined,
        refreshWorkspace: async () => {},
        publishStatus: () => undefined,
        withdraw: () => undefined,
      };
    });
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('REPORTS a refused rendezvous and leaves the adapter unset', () => {
    // Not swallowed, and not fatal. `/peers` then says the feature is unavailable rather than
    // claiming nobody is there — different facts, and the operator acts on the difference: "nobody
    // is there" invites starting a second session, and this does not.
    const adapters: ICommandHostAdapters = {};
    const report = reporter();

    attachHostAdapters(adapters, CONTROLLER, report, () => {
      throw new Error('the rendezvous directory was not admitted');
    });

    expect(adapters.localPeers).toBeUndefined();
    expect(report.said.join(' ')).toContain('not admitted');
    // The rest of the assembly still happened: one capability failing must not take another with it.
    expect(adapters.remoteControl?.getStatus()).toEqual({ state: 'off' });
    expect(adapters.remoteControl?.describeKeyStorage?.()).toBe('OS keychain (macOS Keychain)');
  });

  it('does not let a refusal stop the session', () => {
    expect(() =>
      attachHostAdapters({}, CONTROLLER, reporter(), () => {
        throw new Error('no');
      }),
    ).not.toThrow();
  });
});

describe('PEER-006 — messaging is attached separately from discovery', () => {
  const PRESENCE = {
    sessionId: 'me',
    guardedDirectory: '/tmp/does-not-matter',
    list: () => [],
    listWithWorkspace: async () => [],
    relate: async () => undefined,
    refreshWorkspace: async () => {},
    publishStatus: () => {},
    withdraw: () => {},
  };

  it('fills in `send` once messaging starts', async () => {
    const adapters: ICommandHostAdapters = {};
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE);

    expect(adapters.localPeers?.send).toBeUndefined();

    await attachLocalPeerMessaging(
      adapters,
      PRESENCE,
      () => ({ submit: async () => ({}) }) as never,
      reporter(),
      (async () => ({
        socketPath: '/tmp/x.sock',
        send: async () => ({ id: '1', sequence: 1, state: 'acknowledged' as const }),
        close: async () => {},
      })) as never,
    );

    expect(adapters.localPeers?.send).toBeTypeOf('function');
    await expect(adapters.localPeers?.send?.('other', 'hi')).resolves.toEqual({
      state: 'acknowledged',
    });
  });

  it('fills in `prepareFile` once messaging starts, keeping the model to its workspace', async () => {
    const adapters: ICommandHostAdapters = {};
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE);
    const sent: unknown[] = [];
    await attachLocalPeerMessaging(
      adapters,
      PRESENCE,
      () => ({ submit: async () => ({}) }) as never,
      reporter(),
      (async () => ({
        socketPath: '/tmp/x.sock',
        send: async () => ({ id: '1', sequence: 1, state: 'acknowledged' as const }),
        sendFile: async (target: string, file: unknown) => {
          sent.push([target, file]);
          return { state: 'delivered' as const };
        },
        close: async () => {},
      })) as never,
    );

    const workspace = mkdtempSync(join(tmpdir(), 'prepare-file-'));
    try {
      writeFileSync(join(workspace, 'a.txt'), 'abc');
      const prepare = adapters.localPeers?.prepareFile;
      expect(prepare).toBeTypeOf('function');
      const inside = await prepare!('other', 'a.txt', { origin: 'model', cwd: workspace });
      expect(inside).toMatchObject({ ok: true, file: { size: 3 } });
      await expect(inside.ok ? inside.file.send() : undefined).resolves.toEqual({
        state: 'delivered',
      });
      expect(sent).toHaveLength(1);
      const outside = await prepare!('other', '/etc/hosts', { origin: 'model', cwd: workspace });
      expect(outside.ok).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('leaves discovery working when messaging cannot start', async () => {
    const adapters: ICommandHostAdapters = {};
    const messages: string[] = [];
    const report = { writeError: (message: string) => messages.push(message) };
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE);

    await attachLocalPeerMessaging(adapters, PRESENCE, () => ({}) as never, report, (() =>
      Promise.reject(new Error('the socket could not bind'))) as never);

    // Listing peers and addressing them are different capabilities. Taking discovery down with
    // messaging would turn "I cannot send" into "nobody is there", which invites the wrong action.
    expect(adapters.localPeers?.list).toBeTypeOf('function');
    expect(adapters.localPeers?.send).toBeUndefined();
    expect(messages.join('\n')).toContain('though discovery is on');
  });

  it('does nothing when discovery never came up', async () => {
    const adapters: ICommandHostAdapters = {};
    let started = false;
    await attachLocalPeerMessaging(adapters, undefined, () => ({}) as never, reporter(), (() => {
      started = true;
      return Promise.resolve({}) as never;
    }) as never);

    expect(started).toBe(false);
  });
});

describe('PEER-006 — a session switch does not leak a listener', () => {
  const PRESENCE2 = {
    sessionId: 'me',
    guardedDirectory: '/tmp/does-not-matter',
    list: () => [],
    listWithWorkspace: async () => [],
    relate: async () => undefined,
    refreshWorkspace: async () => {},
    publishStatus: () => {},
    withdraw: () => {},
  };

  it('closes the previous listener before starting the next one', async () => {
    // `onChannelReady` fires again on every session switch — render.tsx says so on the call itself
    // — and the socket path is derived from the session id, which does not change. The listener
    // unlinks the path before binding, so a second bind SUCCEEDS and the first server is orphaned:
    // nothing errors, and a listener plus its fd accumulates per switch.
    const adapters: ICommandHostAdapters = {};
    const closed: number[] = [];
    let started = 0;
    const start = (async () => {
      const id = ++started;
      return {
        socketPath: `/tmp/${id}.sock`,
        send: async () => ({ id: '1', sequence: 1, state: 'acknowledged' as const }),
        close: async () => {
          closed.push(id);
        },
      };
    }) as never;

    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE2);
    const first = await attachLocalPeerMessaging(
      adapters,
      PRESENCE2,
      () => ({}) as never,
      reporter(),
      start,
    );
    await attachLocalPeerMessaging(
      adapters,
      PRESENCE2,
      () => ({}) as never,
      reporter(),
      start,
      Promise.resolve(first),
    );

    expect(started).toBe(2);
    expect(closed).toEqual([1]);
  });

  it('still starts the new listener when closing the old one throws', async () => {
    // A single bad close must not end peer messaging for the rest of the process.
    const adapters: ICommandHostAdapters = {};
    const messages: string[] = [];
    const report = { writeError: (message: string) => messages.push(message) };
    let started = 0;
    const start = (async () => {
      started += 1;
      return {
        socketPath: '/tmp/x.sock',
        send: async () => ({ id: '1', sequence: 1, state: 'acknowledged' as const }),
        close: async () => {},
      };
    }) as never;

    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE2);
    const stubborn = Promise.resolve({
      socketPath: '/tmp/old.sock',
      send: async () => ({ id: '1', sequence: 1, state: 'acknowledged' as const }),
      close: async () => {
        throw new Error('the socket would not release');
      },
    }) as never;

    await attachLocalPeerMessaging(
      adapters,
      PRESENCE2,
      () => ({}) as never,
      report,
      start,
      stubborn,
    );

    expect(started).toBe(1);
    expect(messages.join('\n')).toContain('would not release');
  });
});

describe('linked devices of the device mesh reach /peers and /handoff', () => {
  const PRESENCE3 = {
    sessionId: 'me',
    guardedDirectory: '/tmp/does-not-matter',
    list: () => [{ sessionId: 'me', liveness: 'alive' as const }],
    listWithWorkspace: async () => [],
    relate: async () => undefined,
    refreshWorkspace: async () => {},
    publishStatus: () => {},
    withdraw: () => {},
  };
  const DEVICE = 'D'.repeat(43);

  function fakeMesh() {
    const bound: Record<string, unknown>[] = [];
    return {
      bound,
      devices: () => [{ deviceId: DEVICE, name: 'desktop', locality: 'another-host' as const }],
      isLinked: (id: string) => id === DEVICE,
      send: vi.fn(async () => ({ id: 'm', sequence: 1, state: 'pending' as const })),
      sendFile: vi.fn(async () => ({ state: 'delivered' as const })),
      handoff: vi.fn(),
      bind: (binding: Record<string, unknown>) => bound.push(binding),
    };
  }

  const HANDOFF = {
    sessionStore: {
      load: () => ({ status: 'missing' }),
      save: () => {},
      list: () => [],
      delete: () => {},
    },
    hasOwnProvider: () => true,
    onHandedOff: () => {},
  } as never;

  it('lists linked devices and sends to one over the mesh', async () => {
    const adapters: ICommandHostAdapters = {};
    const mesh = fakeMesh();
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE3, undefined, mesh);

    expect(adapters.localPeers?.listDevices?.()).toEqual(mesh.devices());
    await expect(adapters.localPeers?.send?.(DEVICE, 'hi', { inReplyTo: 'm-0' })).resolves.toEqual({
      state: 'pending',
    });
    expect(mesh.send).toHaveBeenCalledWith(DEVICE, 'hi', { inReplyTo: 'm-0' });
  });

  it('sends a file to a linked device over the mesh', async () => {
    const adapters: ICommandHostAdapters = {};
    const mesh = fakeMesh();
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE3, undefined, mesh);
    const workspace = mkdtempSync(join(tmpdir(), 'mesh-file-'));
    try {
      writeFileSync(join(workspace, 'a.txt'), 'abc');
      const prepared = await adapters.localPeers?.prepareFile?.(DEVICE, 'a.txt', {
        origin: 'operator',
        cwd: workspace,
      });
      if (prepared?.ok !== true) throw new Error('not prepared');
      await expect(prepared.file.send()).resolves.toEqual({ state: 'delivered' });
      expect(mesh.sendFile).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('lists linked devices as /handoff destinations', async () => {
    const adapters: ICommandHostAdapters = {};
    const mesh = fakeMesh();
    attachHostAdapters(adapters, CONTROLLER, reporter(), () => PRESENCE3, HANDOFF, mesh);
    await expect(adapters.handoff?.destinations()).resolves.toEqual([
      { deviceId: DEVICE, name: 'desktop, another of your devices' },
    ]);
  });

  it('still lists and reaches linked devices when local peer discovery fails', async () => {
    const adapters: ICommandHostAdapters = {};
    const mesh = fakeMesh();
    const report = reporter();
    const start = attachHostAdapters(
      adapters,
      CONTROLLER,
      report,
      () => {
        throw new Error('the rendezvous directory was not admitted');
      },
      HANDOFF,
      mesh,
    );

    expect(report.said.join(' ')).toContain('not admitted');
    expect(adapters.localPeers?.list()).toEqual([]);
    expect(adapters.localPeers?.localDiscoveryOff).toContain('not admitted');
    expect(adapters.localPeers?.listDevices?.()).toEqual(mesh.devices());
    await expect(adapters.localPeers?.send?.(DEVICE, 'hi')).resolves.toEqual({ state: 'pending' });
    await expect(adapters.handoff?.destinations()).resolves.toEqual([
      { deviceId: DEVICE, name: 'desktop, another of your devices' },
    ]);
    start({ getSession: () => ({ submit: async () => ({}) }) as never });
    const keys = mesh.bound.flatMap((binding) => Object.keys(binding)).sort();
    expect(keys).toEqual(['handoff', 'ingress']);
  });

  it('gives the mesh the live session and the hand-off receiver', () => {
    const adapters: ICommandHostAdapters = {};
    const mesh = fakeMesh();
    const start = attachHostAdapters(
      adapters,
      CONTROLLER,
      reporter(),
      () => PRESENCE3,
      HANDOFF,
      mesh,
    );
    start({ getSession: () => ({ submit: async () => ({}) }) as never });
    const keys = mesh.bound.flatMap((binding) => Object.keys(binding)).sort();
    expect(keys).toEqual(['handoff', 'ingress']);
  });
});
