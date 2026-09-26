/**
 * Turning the device mesh on at interactive startup: only the explicit user setting opens it, only
 * for a device with an identity, with the default policy and the terminal operator's approver, and
 * exit closes it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { createDeviceMeshHost } from '../device-mesh-host.js';
import { parseMeshSettings } from '../mesh-settings.js';
import { scriptedOperator } from './fake-secret-terminal.js';

import type { IDeviceMeshEndpoint, IOpenDeviceMeshOptions } from '../device-mesh.js';
import type { IOperatorApprover } from '@robota-sdk/agent-interface-session-mobility';
import {
  MeshLinkEndedError,
  MeshRelayNeededError,
  type IDeviceMeshRefusal,
} from '@robota-sdk/agent-transport-webrtc';

let home: string;
let root: string;
const store = () => createFileCredentialStore(join(root, 'credentials'), { withinRoot: root });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-mesh-host-'));
  root = join(home, '.robota');
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

async function withIdentity(): Promise<void> {
  const service = createDeviceIdentityService({
    directory: join(root, 'devices'),
    withinRoot: root,
    store: store(),
    openTerminal: () => scriptedOperator().session,
    defaultDeviceName: () => 'laptop',
  });
  expect((await service.init({})).ok).toBe(true);
}

function fakeOpen() {
  const close = vi.fn();
  const refresh = vi.fn(async () => undefined);
  const refusals: ((refusal: IDeviceMeshRefusal) => void)[] = [];
  const endpoint = {
    node: {
      onLink: () => () => undefined,
      onRefusal: (handler: (refusal: IDeviceMeshRefusal) => void) => {
        refusals.push(handler);
        return () => undefined;
      },
      stop: () => undefined,
    },
    refresh,
    close,
  } as unknown as IDeviceMeshEndpoint;
  const open = vi.fn(async (_options: IOpenDeviceMeshOptions) => endpoint);
  const refuse = (refusal: IDeviceMeshRefusal): void => {
    for (const handler of refusals) handler(refusal);
  };
  return { open, close, refuse, refresh };
}

const APPROVER: IOperatorApprover = { approve: async () => false };
const NO_INTERNET = { dht: false, pkarrRelays: [], nostrRelays: [] };

function host(
  transports: unknown,
  open: ReturnType<typeof fakeOpen>['open'],
  said: string[] = [],
  lockStaleMs?: number,
) {
  return createDeviceMeshHost({
    root,
    store: store(),
    readTransports: () => transports,
    open,
    lan: false,
    relay: () => undefined,
    report: (message) => said.push(message),
    ...(lockStaleMs !== undefined ? { lockStaleMs } : {}),
  });
}

describe('the mesh setting', () => {
  it('is off unless set, and takes presence, message, file and handoff by default', () => {
    expect(parseMeshSettings(undefined).enabled).toBe(false);
    expect(parseMeshSettings({ mesh: { options: NO_INTERNET } }).enabled).toBe(false);
    const on = parseMeshSettings({ mesh: { enabled: true } });
    expect(on.enabled).toBe(true);
    expect(on.policy).toEqual(['file', 'handoff', 'message', 'presence']);
  });

  it('keeps delegate, observe and drive off unless configured', () => {
    const policy = parseMeshSettings({ mesh: { enabled: true } }).policy;
    for (const capability of ['delegate', 'observe', 'drive']) {
      expect(policy).not.toContain(capability);
    }
    expect(
      parseMeshSettings({
        mesh: { enabled: true, options: { capabilities: ['message', 'drive'] } },
      }).policy,
    ).toEqual(['drive', 'message']);
  });

  it('refuses a malformed value, naming the setting', () => {
    expect(() => parseMeshSettings({ mesh: { enabled: 'yes' } })).toThrow(
      /transports\.mesh\.enabled/,
    );
    expect(() =>
      parseMeshSettings({ mesh: { enabled: true, options: { capabilities: ['everything'] } } }),
    ).toThrow(/capabilities/);
  });
});

describe('where the setting is read', () => {
  const realHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = realHome;
    vi.restoreAllMocks();
  });

  function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }

  function hostUnderHome(open: ReturnType<typeof fakeOpen>['open']) {
    process.env.HOME = home;
    return createDeviceMeshHost({
      store: store(),
      open,
      lan: false,
      relay: () => undefined,
      report: () => undefined,
    });
  }

  it('opens from the user settings under HOME', async () => {
    await withIdentity();
    writeJson(join(root, 'settings.json'), {
      transports: { mesh: { enabled: true, options: NO_INTERNET } },
    });
    const { open } = fakeOpen();
    await hostUnderHome(open).start({ operatorApprover: APPROVER });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('never opens because a project turns it on', async () => {
    await withIdentity();
    const project = join(home, 'project');
    const on = { transports: { mesh: { enabled: true, options: NO_INTERNET } } };
    for (const file of [
      join('.robota', 'settings.json'),
      join('.robota', 'settings.local.json'),
      join('.claude', 'settings.json'),
      join('.claude', 'settings.local.json'),
    ]) {
      writeJson(join(project, file), on);
    }
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    const { open } = fakeOpen();
    const mesh = hostUnderHome(open);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();
    expect(mesh.status().state).toBe('off');
  });
});

describe('opening the mesh at startup', () => {
  it('opens nothing when the setting is off', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const mesh = host({ mesh: { options: NO_INTERNET } }, open);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();
    expect(mesh.status().state).toBe('off');
  });

  it('opens nothing for a device with no identity, and points to /devices join as well as init', async () => {
    const { open } = fakeOpen();
    const said: string[] = [];
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open, said);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();
    expect(mesh.status().state).toBe('off');
    const text = said.join('\n');
    expect(text).toContain('/devices join');
    expect(text).toContain('/devices add');
    expect(text).toContain('/devices init');
    // `init` on a device of a user who has others makes an identity that can never link to them.
    expect(text).toMatch(/separate identity/);
    expect(text).toMatch(/never link/);
  });

  it('opens once an identity is created mid-session, with the approver it was started with', async () => {
    const { open } = fakeOpen();
    const said: string[] = [];
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open, said);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();

    await withIdentity();
    await mesh.identityChanged();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].operatorApprover).toBe(APPROVER);
    expect(mesh.status().state).toBe('on');
    expect(mesh.ownDeviceId()).toBeDefined();
  });

  it('opens nothing on an identity change when the setting is off, or before startup asked', async () => {
    await withIdentity();
    const off = fakeOpen();
    const disabled = host({ mesh: { options: NO_INTERNET } }, off.open);
    await disabled.start({ operatorApprover: APPROVER });
    await disabled.identityChanged();
    expect(off.open).not.toHaveBeenCalled();

    const early = fakeOpen();
    const notStarted = host({ mesh: { enabled: true, options: NO_INTERNET } }, early.open);
    await notStarted.identityChanged();
    expect(early.open).not.toHaveBeenCalled();
  });

  it('puts changed lists in force on the open mesh, which pushes them to the linked devices', async () => {
    await withIdentity();
    const { open, refresh } = fakeOpen();
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open);
    await mesh.start({ operatorApprover: APPROVER });
    await mesh.identityChanged();
    expect(open).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('opens it with the default policy and the terminal approver when the setting is on', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0]![0];
    expect(options.localPolicy).toEqual(['file', 'handoff', 'message', 'presence']);
    expect(options.operatorApprover).toBe(APPROVER);
    expect(options.root).toBe(root);
    expect(mesh.status()).toMatchObject({ state: 'on', linked: [] });
  });

  it('is opened by one session of a device at a time', async () => {
    await withIdentity();
    const settings = { mesh: { enabled: true, options: NO_INTERNET } };
    const first = fakeOpen();
    const second = fakeOpen();
    const said: string[] = [];
    const holder = host(settings, first.open);
    const other = host(settings, second.open, said);
    await holder.start({ operatorApprover: APPROVER });
    await other.start({ operatorApprover: APPROVER });
    expect(first.open).toHaveBeenCalledTimes(1);
    expect(second.open).not.toHaveBeenCalled();
    expect(other.status()).toMatchObject({ state: 'failed' });
    expect(other.status().reason).toMatch(/another Robota session/);
    expect(said.join('\n')).toMatch(/another Robota session/);

    // Once the holder exits, the lock is gone before `close` returns — a process exiting right after
    // leaves none behind — and the next session opens it.
    const lock = join(root, 'devices', 'mesh.lock');
    expect(existsSync(lock)).toBe(true);
    holder.close();
    expect(existsSync(lock)).toBe(false);
    const third = fakeOpen();
    await host(settings, third.open).start({ operatorApprover: APPROVER });
    expect(third.open).toHaveBeenCalledTimes(1);
  });

  it('closes its mesh, and says why, once another session took the mesh over after a stall', async () => {
    await withIdentity();
    const { open, close } = fakeOpen();
    const said: string[] = [];
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open, said, 150);
    await mesh.start({ operatorApprover: APPROVER });
    expect(mesh.status().state).toBe('on');

    // Another session found this one's lock stale (this machine slept) and took it over.
    const lock = join(root, 'devices', 'mesh.lock');
    writeFileSync(lock, 'another-session');

    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(mesh.status().state).toBe('failed');
    expect(mesh.status().reason).toMatch(/another Robota session .* took it over/);
    expect(mesh.ownDeviceId()).toBeUndefined();
    expect(said.join('\n')).toMatch(/took it over/);
    // The session that took it over keeps its lock, and this one does not reopen on its own.
    mesh.close();
    expect(readFileSync(lock, 'utf8')).toBe('another-session');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('passes the relay settings to the mesh it opens', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const relay = { serve: true, port: 3479, relayPorts: { min: 49160, max: 49170 } };
    const turnServers = [{ urls: 'turn:turn.example.org:3478', username: 'u', credential: 'c' }];
    // The DHT carries the relay's address to the other devices; no Nostr relays.
    const options = { nostrRelays: [], relay, turnServers, relayOnly: true };
    const mesh = host({ mesh: { enabled: true, options } }, open);
    await mesh.start({ operatorApprover: APPROVER });

    expect(open).toHaveBeenCalledTimes(1);
    const settings = open.mock.calls[0]![0].internet?.settings;
    expect(settings?.relay).toMatchObject({ serve: true, port: 3479, allowPrivatePeers: true });
    expect(settings?.turnServers).toEqual(turnServers);
    expect(settings?.relayOnly).toBe(true);
    expect(mesh.status().sources).toEqual([
      'the Mainline DHT',
      'relays only: the relays your devices run, then 1 TURN server of yours',
      'your relay for your other devices, on port 3479',
    ]);
  });

  it('uses TURN servers of the user even with public discovery off', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const turnServers = [{ urls: 'turn:turn.example.org:3478', username: 'u', credential: 'c' }];
    const mesh = host({ mesh: { enabled: true, options: { ...NO_INTERNET, turnServers } } }, open);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open.mock.calls[0]![0].internet?.settings.turnServers).toEqual(turnServers);
    expect(mesh.status().sources).toEqual(['1 TURN server of yours when no direct path works']);
  });

  it('refuses to run a relay no device could learn of', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const said: string[] = [];
    const options = { ...NO_INTERNET, relay: { serve: true } };
    const mesh = host({ mesh: { enabled: true, options } }, open, said);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();
    expect(mesh.status()).toMatchObject({ state: 'failed' });
    expect(said.join('\n')).toMatch(/relay\.serve/);
  });

  it('says when a device needs a relay, once, and says nothing of other refusals', async () => {
    await withIdentity();
    const { open, refuse } = fakeOpen();
    const said: string[] = [];
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open, said);
    await mesh.start({ operatorApprover: APPROVER });
    const needed = new MeshRelayNeededError('device-b', 'relay-only');
    refuse({ deviceId: 'device-b', end: 'signaling', error: needed });
    refuse({ deviceId: 'device-b', end: 'signaling', error: needed });
    refuse({
      deviceId: 'device-c',
      end: 'handshake',
      error: new MeshLinkEndedError({ end: 'handshake', stage: 'handshake', role: 'offerer' }),
    });
    const relayLines = said.filter((line) => line.includes('a relay device is needed'));
    expect(relayLines).toHaveLength(1);
    expect(relayLines[0]).toContain('device-b');
    expect(said.join('\n')).not.toContain('device-c');
  });

  it('refuses a malformed relay setting at startup, naming it', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const said: string[] = [];
    const mesh = host(
      { mesh: { enabled: true, options: { ...NO_INTERNET, relay: { host: '::' } } } },
      open,
      said,
    );
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();
    expect(mesh.status()).toMatchObject({ state: 'failed' });
    expect(said.join('\n')).toMatch(/relay\.host/);
  });

  it('names how it finds devices', async () => {
    await withIdentity();
    const { open } = fakeOpen();
    const mesh = createDeviceMeshHost({
      root,
      store: store(),
      readTransports: () => ({ mesh: { enabled: true, options: { pkarrRelays: [] } } }),
      open,
      relay: () => undefined,
      report: () => undefined,
    });
    await mesh.start({ operatorApprover: APPROVER });
    expect(mesh.status().sources).toEqual([
      'the local network (mDNS, remembered addresses)',
      'the Mainline DHT',
      `${parseMeshSettings({ mesh: {} }).internet.nostrRelays.length} Nostr relays`,
    ]);
  });

  it('says it could not start when opening fails, and the session goes on', async () => {
    await withIdentity();
    const open = vi.fn(async () => {
      throw new Error('address in use');
    });
    const said: string[] = [];
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open, said);
    await mesh.start({ operatorApprover: APPROVER });
    expect(mesh.status()).toMatchObject({ state: 'failed', reason: 'address in use' });
    expect(said.join('\n')).toContain('address in use');
  });

  it('closes the mesh on exit', async () => {
    await withIdentity();
    const { open, close } = fakeOpen();
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open);
    await mesh.start({ operatorApprover: APPROVER });
    mesh.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(mesh.status().state).toBe('off');
  });

  it('closes a mesh that finishes opening after exit', async () => {
    await withIdentity();
    const { close } = fakeOpen();
    let finish: () => void = () => undefined;
    const open = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { node: { onLink: () => () => undefined }, close } as unknown as IDeviceMeshEndpoint;
    });
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open);
    const starting = mesh.start({ operatorApprover: APPROVER });
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    mesh.close();
    finish();
    await starting;
    expect(close).toHaveBeenCalledTimes(1);
    expect(mesh.status().state).toBe('off');
  });
});
