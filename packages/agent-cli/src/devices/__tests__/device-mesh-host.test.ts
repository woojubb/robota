/**
 * Turning the device mesh on at interactive startup: only the explicit user setting opens it, only
 * for a device with an identity, with the default policy and the terminal operator's approver, and
 * exit closes it.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const endpoint = {
    node: { onLink: () => () => undefined, stop: () => undefined },
    refresh: async () => undefined,
    close,
  } as unknown as IDeviceMeshEndpoint;
  const open = vi.fn(async (_options: IOpenDeviceMeshOptions) => endpoint);
  return { open, close };
}

const APPROVER: IOperatorApprover = { approve: async () => false };
const NO_INTERNET = { dht: false, pkarrRelays: [], nostrRelays: [] };

function host(transports: unknown, open: ReturnType<typeof fakeOpen>['open'], said: string[] = []) {
  return createDeviceMeshHost({
    root,
    store: store(),
    readTransports: () => transports,
    open,
    lan: false,
    relay: () => undefined,
    report: (message) => said.push(message),
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

  it('opens nothing for a device with no identity, and says to run /devices init', async () => {
    const { open } = fakeOpen();
    const said: string[] = [];
    const mesh = host({ mesh: { enabled: true, options: NO_INTERNET } }, open, said);
    await mesh.start({ operatorApprover: APPROVER });
    expect(open).not.toHaveBeenCalled();
    expect(mesh.status().state).toBe('off');
    expect(said.join('\n')).toContain('/devices init');
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
