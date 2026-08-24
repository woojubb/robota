import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import {
  deriveReconnectRendezvous,
  deriveReconnectSeed,
  generatePairingSecret,
} from '@robota-sdk/agent-remote-pairing';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { ISignalingClient } from '@robota-sdk/agent-transport-webrtc';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { IHostIdentity } from '../host-identity.js';
import { RemoteControlController } from '../remote-control-controller.js';
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
    join(mkdtempSync(join(tmpdir(), 'robota-rc-registry-')), 'settings.json'),
  );
}

/**
 * REMOTE-013 E4 TC-04/05 (host) — the controller reconnect orchestration with fakes (no werift): first-pair
 * persists the reconnect seed+counter; a drop re-arms the `{counter, counter+1}` rooms at the rotating
 * rendezvous; a confirmed reconnect advances the counter (resync-on-success); the ceiling frees the session.
 */

interface ICreatedTransport {
  hooks: {
    onPaired: (r?: { sessionKey: string }) => void;
    onPairingFailed: () => void;
    onDropped?: () => void;
  };
  reconnect: unknown;
  bridge: unknown;
  rendezvous: string | undefined;
  transport: IConfigurableTransport<IInteractiveSession>;
}

/** Deterministically wait until the async reconnect-seed persist has landed (WebCrypto HKDF is not sync). */
async function waitForSeed(store: ITrustedDeviceStore, deviceId: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (store.get(deviceId)?.reconnectSeed) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('reconnect seed was never persisted');
}

function memoryStore(): ITrustedDeviceStore {
  const map = new Map<string, ITrustedDeviceRecord>();
  return {
    list: () => [...map.values()],
    get: (id) => map.get(id),
    upsert: (r) => void map.set(r.deviceId, r),
    revoke: (id) => map.delete(id),
  };
}

function fakeTransport(): IConfigurableTransport<IInteractiveSession> {
  return {
    name: 'webrtc',
    // Issue #2043: `TransportRegistry.register` refuses a transport whose lifecycle shape disagrees
    // with its `waitForCompletion` presence. This omitted `lifecycle` and nothing noticed, because
    // `register` was stubbed to a no-op — the cast below hid it from the compiler and the no-op hid
    // it from the runtime.
    lifecycle: { kind: 'service' as const },
    defaultEnabled: false,
    attach: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    validateOptions: () => true,
  } as unknown as IConfigurableTransport<IInteractiveSession>;
}

async function hostIdentity(): Promise<IHostIdentity> {
  // A minimal identity — the reconnect orchestration only reads hostIdentityId/publicKeySpki here.
  return {
    keyPair: {} as CryptoKeyPair,
    publicKeySpki: 'host-spki',
    hostIdentityId: 'host-id',
  };
}

function setup(store: ITrustedDeviceStore, identity: IHostIdentity) {
  const created: ICreatedTransport[] = [];
  const rendezvouses: string[] = [];
  const ceilings: { cb: () => void; delayMs: number }[] = [];
  const session = Object.assign(createTestInteractiveSession(), {
    on: vi.fn(),
    off: vi.fn(),
    getMessages: () => [],
  });
  const registry = realRegistry();
  const controller = new RemoteControlController({
    registry,
    readRelayUrl: () => 'ws://relay',
    readClientUrl: () => 'https://client/',
    getSession: () => session,
    renderQr: () => Promise.resolve('[QR]'),
    trustedDeviceStore: store,
    loadHostIdentity: () => Promise.resolve(identity),
    createResumeBridge: () =>
      ({
        dispose: vi.fn(),
        attach: vi.fn(),
        detach: vi.fn(),
        onClientMessage: vi.fn(),
        setDriverId: vi.fn(), // REMOTE-014 E5: onEnroll binds the paired device id as the co-drive driver id
      }) as never,
    createSignaling: (_url, rendezvous) => {
      rendezvouses.push(rendezvous);
      return {
        send: vi.fn(),
        onSignal: vi.fn(() => () => {}),
        close: vi.fn(),
      } as unknown as ISignalingClient;
    },
    schedule: (cb, delayMs) => {
      ceilings.push({ cb, delayMs });
      return () => {
        const i = ceilings.findIndex((c) => c.cb === cb);
        if (i >= 0) ceilings.splice(i, 1);
      };
    },
    createTransport: (_s, _secret, hooks, _ice, reconnect, bridge) => {
      const transport = fakeTransport();
      created.push({
        hooks,
        reconnect,
        bridge,
        rendezvous: rendezvouses[rendezvouses.length - 1],
        transport,
      });
      return transport;
    },
  });
  return { controller, created, rendezvouses, ceilings, session, registry };
}

describe('RemoteControlController E4 reconnect (REMOTE-013)', () => {
  it('first pair persists the reconnect seed+counter; a drop re-arms the counter/counter+1 rooms', async () => {
    const store = memoryStore();
    const { controller, created } = setup(store, await hostIdentity());
    await controller.enable();

    // First-pair: enroll the device, then accept with a sessionKey → seed persisted.
    const reconnectCfg = created[0].reconnect as { onEnroll: (id: string, spki: string) => void };
    reconnectCfg.onEnroll('dev-1', 'dev-spki');
    const sessionKey = generatePairingSecret().secret;
    created[0].hooks.onPaired({ sessionKey });
    await waitForSeed(store, 'dev-1'); // let the async seed persist settle

    const seed = await deriveReconnectSeed(sessionKey);
    const record = store.get('dev-1');
    expect(record?.reconnectSeed).toBe(seed);
    expect(record?.reconnectCounter).toBe(0);
    expect(created[0].bridge).toBeDefined(); // the resume bridge was passed to the transport

    // Drop the paired channel → the controller registers the two reconnect rooms (async HKDF derivations).
    created[0].hooks.onDropped?.();
    await new Promise((r) => setTimeout(r, 25));
    const reconnectRooms = created.slice(1).map((c) => c.rendezvous);
    expect(reconnectRooms).toContain(await deriveReconnectRendezvous(seed, 0));
    expect(reconnectRooms).toContain(await deriveReconnectRendezvous(seed, 1));
  });

  it('a confirmed reconnect advances the counter (resync-on-success) and promotes the winner', async () => {
    const store = memoryStore();
    const { controller, created, ceilings } = setup(store, await hostIdentity());
    await controller.enable();
    (created[0].reconnect as { onEnroll: (id: string, spki: string) => void }).onEnroll(
      'dev-1',
      'spki',
    );
    const sessionKey = generatePairingSecret().secret;
    created[0].hooks.onPaired({ sessionKey });
    await waitForSeed(store, 'dev-1');

    created[0].hooks.onDropped?.();
    await new Promise((r) => setTimeout(r, 25));
    const seed = (store.get('dev-1') as ITrustedDeviceRecord).reconnectSeed as string;
    // The device came back in the counter+1 room (it had advanced; host had not).
    const room1 = await deriveReconnectRendezvous(seed, 1);
    const winner = created.slice(1).find((c) => c.rendezvous === room1)!;
    expect(ceilings).toHaveLength(1); // ceiling armed
    winner.hooks.onPaired(); // reconnect confirmed at counter 1

    expect(store.get('dev-1')?.reconnectCounter).toBe(2); // resync-on-success: used(1) + 1
    expect(ceilings).toHaveLength(0); // ceiling cancelled on reconnect
    expect(controller.getStatus()).toEqual({ state: 'paired' });
  });

  it('a drop leaves exactly one webrtc entry — candidates are not registered (issue #2043)', async () => {
    const store = memoryStore();
    const { controller, created, registry } = setup(store, await hostIdentity());
    await controller.enable();
    (created[0].reconnect as { onEnroll: (id: string, spki: string) => void }).onEnroll(
      'dev-1',
      'spki',
    );
    created[0].hooks.onPaired({ sessionKey: generatePairingSecret().secret });
    await waitForSeed(store, 'dev-1');

    created[0].hooks.onDropped?.();
    await new Promise((r) => setTimeout(r, 25));

    // A drop opens TWO reconnect rooms while the original entry is still present. Registering each
    // candidate threw `Duplicate transport name: webrtc` out of a callback nothing observed, so the
    // suite stayed green on its assertions while six rejections went unhandled. The count is the
    // observable that distinguishes "not registered" from "registered and the throw was swallowed".
    expect(registry.getAll().filter((e) => e.transport.name === 'webrtc')).toHaveLength(1);
    expect(created.length).toBeGreaterThan(1); // rooms really were opened

    // The entry count alone does not distinguish "never registered" from "register threw", because a
    // throw leaves the count at one too. What separates them is whether the candidates became
    // USABLE: `register` ran before `attach`/`start`, so a throw there left every candidate created
    // and never attached — the reconnect rooms existed and no device could be served by them.
    for (const candidate of created.slice(1)) {
      expect(candidate.transport.attach).toHaveBeenCalled();
      expect(candidate.transport.start).toHaveBeenCalled();
    }
  });

  it('promotion swaps the registry entry to the winner, not the abandoned peer (issue #2043)', async () => {
    const store = memoryStore();
    const { controller, created, registry } = setup(store, await hostIdentity());
    await controller.enable();
    (created[0].reconnect as { onEnroll: (id: string, spki: string) => void }).onEnroll(
      'dev-1',
      'spki',
    );
    created[0].hooks.onPaired({ sessionKey: generatePairingSecret().secret });
    await waitForSeed(store, 'dev-1');

    const original = created[0].transport;
    created[0].hooks.onDropped?.();
    await new Promise((r) => setTimeout(r, 25));
    const seed = (store.get('dev-1') as ITrustedDeviceRecord).reconnectSeed as string;
    const room1 = await deriveReconnectRendezvous(seed, 1);
    const winner = created.slice(1).find((c) => c.rendezvous === room1)!;
    winner.hooks.onPaired();

    // Without the swap the entry keeps naming a peer the controller abandoned, so `stopAll` at
    // shutdown stops that one and never reaches the peer actually serving the session.
    const entry = registry.getAll().find((e) => e.transport.name === 'webrtc');
    expect(entry?.transport).toBe(winner.transport);
    expect(entry?.transport).not.toBe(original);
    expect(controller.getStatus()).toEqual({ state: 'paired' });
  });

  it('the reconnect-window ceiling frees the session when no device returns', async () => {
    const store = memoryStore();
    const { controller, created, ceilings } = setup(store, await hostIdentity());
    await controller.enable();
    (created[0].reconnect as { onEnroll: (id: string, spki: string) => void }).onEnroll(
      'dev-1',
      'spki',
    );
    created[0].hooks.onPaired({ sessionKey: generatePairingSecret().secret });
    await waitForSeed(store, 'dev-1');
    created[0].hooks.onDropped?.();
    await new Promise((r) => setTimeout(r, 25));

    expect(ceilings).toHaveLength(1);
    ceilings[0].cb(); // fire the ceiling — no device returned
    await new Promise((r) => setTimeout(r, 0));
    expect(controller.getStatus()).toEqual({ state: 'off' });
  });
});
