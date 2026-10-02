import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import {
  deriveIdentityId,
  exportPublicKey,
  generateIdentityKeyPair,
} from '@robota-sdk/agent-remote-pairing';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IProtocolSession } from '@robota-sdk/agent-transport';
import type { IHostReconnectConfig, ISignalingClient } from '@robota-sdk/agent-transport-webrtc';
import { TransportRegistry } from '@robota-sdk/agent-framework';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { IHostIdentity } from '../host-identity.js';
import { RemoteControlController } from '../remote-control-controller.js';
import type { IRemoteControlControllerDeps } from '../remote-control-controller.js';
import { createRemoteControlTransportHost } from '../transport-host-adapter.js';
import { createTestRuntimeContext } from '../../devices/__tests__/runtime-context-fixture.js';
import type { ITrustedDeviceRecord, ITrustedDeviceStore } from '../trusted-device-store.js';

/**
 * The REAL registry, not `{ register: () => {} }`.
 *
 * Issue #2043: these suites used to stub `register` with a no-op, which removed the one rule the
 * reconnect path breaks — `register` refuses a duplicate `transport.name`, and every
 * `WebRtcTransport` is named `webrtc`. A double whose refusal is the defect cannot fail on it, so
 * the reconnect tests passed while every reconnect registration threw in production.
 *
 * Constructed with a temp settings path: the registry only reads it for saved transport config, and
 * an absent file means "no saved config", which is what these tests want.
 */
function realRegistry(): TransportRegistry {
  return new TransportRegistry(
    join(realpathSync(mkdtempSync(join(tmpdir(), 'agent-fixture-rc-registry-'))), 'settings.json'),
  );
}

/**
 * REMOTE-012 E3 TC-05/08 — the controller wires a reconnect config from the host identity + trusted-device
 * store, its `onEnroll` pins a device, `resolveDevicePublicKey` reads it back, and `listDevices`/`revokeDevice`
 * delegate to the store.
 */

function memoryStore(): ITrustedDeviceStore {
  const map = new Map<string, ITrustedDeviceRecord>();
  return {
    list: () => [...map.values()],
    get: (id) => map.get(id),
    upsert: (r) => void map.set(r.deviceId, r),
    revoke: (id) => map.delete(id),
  };
}

async function hostIdentity(): Promise<IHostIdentity> {
  const keyPair = await generateIdentityKeyPair(true);
  const publicKeySpki = await exportPublicKey(keyPair.publicKey);
  return { keyPair, publicKeySpki, hostIdentityId: await deriveIdentityId(publicKeySpki) };
}

function build(
  store: ITrustedDeviceStore,
  identity: IHostIdentity,
): {
  controller: RemoteControlController;
  captured: {
    reconnect?: IHostReconnectConfig;
    hooks?: Parameters<NonNullable<IRemoteControlControllerDeps['createTransport']>>[3];
    transport?: IConfigurableTransport<IProtocolSession>;
    signaling?: ISignalingClient;
  };
} {
  const captured: ReturnType<typeof build>['captured'] = {};
  const controller = new RemoteControlController({
    productRuntime: createTestRuntimeContext('/tmp/remote-control-e3-test'),
    host: createRemoteControlTransportHost(realRegistry()),
    readRelayUrl: () => 'ws://127.0.0.1:9999',
    readClientUrl: () => 'https://remote.example/',
    getSession: () => stubSession(),
    renderQr: () => Promise.resolve('[QR]'),
    createSignaling: () => {
      const signaling = {
        send: vi.fn(),
        onSignal: vi.fn(() => () => {}),
        close: vi.fn(),
      } as unknown as ISignalingClient;
      captured.signaling = signaling;
      return signaling;
    },
    trustedDeviceStore: store,
    loadHostIdentity: () => Promise.resolve(identity),
    createTransport: (_context, _s, _secret, hooks, _ice, reconnect) => {
      captured.reconnect = reconnect;
      captured.hooks = hooks;
      const transport = {
        name: 'webrtc',
        // Issue #2043: the real `WebRtcTransport` declares `lifecycle: { kind: 'service' }` and has no
        // `waitForCompletion`, and `TransportRegistry.register` refuses a transport whose shape
        // disagrees. This stub omitted it and nothing noticed, because `register` was a no-op double
        // — the `as unknown as` cast hid the missing member from the compiler, and the no-op hid it
        // from the runtime.
        lifecycle: { kind: 'service' as const },
        defaultEnabled: false,
        attach: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        validateOptions: () => true,
      } as unknown as IConfigurableTransport<IProtocolSession>;
      captured.transport = transport;
      return transport;
    },
  });
  return { controller, captured };
}

function stubSession(): IProtocolSession {
  return Object.assign(createTestInteractiveSession(), {
    on: vi.fn(),
    off: vi.fn(),
    getMessages: () => [],
  });
}

describe('RemoteControlController E3 wiring (REMOTE-012)', () => {
  it('passes a reconnect config carrying the host identity; onEnroll pins + resolve reads back', async () => {
    const store = memoryStore();
    const identity = await hostIdentity();
    const { controller, captured } = build(store, identity);

    await controller.enable();
    const rc = captured.reconnect;
    expect(rc).toBeDefined();
    expect(rc?.hostIdentityId).toBe(identity.hostIdentityId);
    expect(rc?.hostPublicSpki).toBe(identity.publicKeySpki);

    // A brand-new device is unknown until enrolled.
    const device = await generateIdentityKeyPair(false);
    const deviceSpki = await exportPublicKey(device.publicKey);
    const deviceId = await deriveIdentityId(deviceSpki);
    expect(await rc?.resolveDevicePublicKey(deviceId)).toBeUndefined();

    rc?.onEnroll(deviceId, deviceSpki);
    expect(store.get(deviceId)?.publicKey).toBe(deviceSpki);
    expect(await rc?.resolveDevicePublicKey(deviceId)).toBeTruthy(); // now resolvable
  });

  it('listDevices / revokeDevice delegate to the store', async () => {
    const store = memoryStore();
    store.upsert({
      deviceId: 'dev-1',
      publicKey: 'spki',
      label: 'phone',
      createdAt: 't',
      lastSeenAt: 't',
    });
    const { controller } = build(store, await hostIdentity());
    expect(controller.listDevices()).toHaveLength(1);
    expect(controller.revokeDevice('dev-1')).toBe(true);
    expect(controller.listDevices()).toHaveLength(0);
    expect(controller.revokeDevice('missing')).toBe(false);
  });

  it('revoking the paired device ends its active connection and prevents late enrollment', async () => {
    const store = memoryStore();
    const { controller, captured } = build(store, await hostIdentity());
    await controller.enable();
    expect(() => captured.reconnect?.onEnroll('dev-1', 'fixture-spki')).not.toThrow();
    captured.hooks?.onPaired();
    expect(controller.getStatus()).toEqual({ state: 'paired' });
    expect(controller.revokeDevice('dev-1')).toBe(true);
    await Promise.resolve();
    expect(captured.transport?.stop).toHaveBeenCalledOnce();
    expect(captured.signaling?.close).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({ state: 'off' });
    expect(() => captured.reconnect?.onEnroll('dev-1', 'fixture-spki')).toThrow(
      /no longer authorized/,
    );
    expect(store.get('dev-1')).toBeUndefined();
  });

  it('stopped enrollment callbacks cannot repopulate device trust', async () => {
    const store = memoryStore();
    const { controller, captured } = build(store, await hostIdentity());
    await controller.enable();
    await controller.stop();
    expect(() => captured.reconnect?.onEnroll('late-device', 'fixture-spki')).toThrow(
      /no longer authorized/,
    );
    expect(store.list()).toEqual([]);
  });

  it('a key imported across device revocation is refused', async () => {
    const store = memoryStore();
    const device = await generateIdentityKeyPair(false);
    const spki = await exportPublicKey(device.publicKey);
    const { controller, captured } = build(store, await hostIdentity());
    await controller.enable();
    captured.reconnect?.onEnroll('dev-1', spki);
    expect(await captured.reconnect?.resolveDevicePublicKey('dev-1')).toBeTruthy();
    const importing = captured.reconnect?.resolveDevicePublicKey('dev-1');
    controller.revokeDevice('dev-1');
    expect(await importing).toBeUndefined();
    await controller.stop();
  });

  it('revoking an unrelated trusted device preserves the paired connection', async () => {
    const store = memoryStore();
    const { controller, captured } = build(store, await hostIdentity());
    await controller.enable();
    captured.reconnect?.onEnroll('dev-1', 'fixture-spki');
    captured.hooks?.onPaired();
    store.upsert({
      deviceId: 'dev-2',
      publicKey: 'other-spki',
      label: 'other',
      createdAt: 't',
      lastSeenAt: 't',
    });
    expect(controller.revokeDevice('dev-2')).toBe(true);
    expect(store.get('dev-1')).toBeDefined();
    expect(captured.transport?.stop).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ state: 'paired' });
    expect(() => captured.reconnect?.onEnroll('dev-2', 'other-spki')).toThrow(
      /no longer authorized/,
    );
    expect(store.get('dev-2')).toBeUndefined();
    await controller.stop();
  });

  it('with no store configured, listDevices is empty and reconnect config is absent', async () => {
    const captured: { reconnect?: IHostReconnectConfig } = {};
    const controller = new RemoteControlController({
      productRuntime: createTestRuntimeContext('/tmp/remote-control-e3-test'),
      host: createRemoteControlTransportHost(realRegistry()),
      readRelayUrl: () => 'ws://127.0.0.1:9999',
      readClientUrl: () => 'https://remote.example/',
      getSession: () => stubSession(),
      renderQr: () => Promise.resolve('[QR]'),
      createSignaling: () =>
        ({
          send: vi.fn(),
          onSignal: vi.fn(() => () => {}),
          close: vi.fn(),
        }) as unknown as ISignalingClient,
      createTransport: (_context, _s, _secret, _h, _ice, reconnect) => {
        captured.reconnect = reconnect;
        return {
          name: 'webrtc',
          // See the note on the sibling stub above: `lifecycle` was missing here too.
          lifecycle: { kind: 'service' as const },
          defaultEnabled: false,
          attach: vi.fn(),
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          validateOptions: () => true,
        } as unknown as IConfigurableTransport<IProtocolSession>;
      },
    });
    await controller.enable();
    expect(captured.reconnect).toBeUndefined();
    expect(controller.listDevices()).toEqual([]);
  });
});
