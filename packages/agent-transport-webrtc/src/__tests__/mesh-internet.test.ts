/**
 * Beyond the local network: rendezvous records on public item stores (the Mainline DHT, pkarr
 * relays) and live signaling over public Nostr relays — all through in-process fakes; nothing here
 * reaches the public network.
 */
import {
  RENDEZVOUS_EPOCH_MS,
  derivePairRendezvous,
  issueDeviceRevocationList,
  rendezvousEpoch,
  startDeviceHandshake,
} from '@robota-sdk/agent-remote-pairing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DeviceMeshNode, type IDeviceMeshLink } from '../device-mesh-node.js';
import { DiscoveringMeshRelay } from '../discovering-mesh-relay.js';
import { startMainlineDhtStore, type IMainlineDht } from '../mainline-dht-store.js';
import { MeshDht } from '../mesh-dht.js';
import {
  createInMemoryItemNetwork,
  createPkarrRelayStore,
  decodePkarrPacket,
  encodePkarrPacket,
  type IInMemoryItemNetwork,
  type IRendezvousItemStore,
} from '../mesh-item-store.js';
import { startMeshLanListener } from '../mesh-lan-listener.js';
import { MeshPeerLink } from '../mesh-peer-link.js';
import {
  HINTS_PADDED_BYTES,
  bep44SignedBytes,
  ed25519FromSeed,
  itemAddress,
  publishJitter,
  signMutableItem,
} from '../mesh-records.js';
import { createInMemoryMeshRelayHub, type IMeshRelay } from '../mesh-relay.js';
import {
  NostrMeshRelay,
  createInMemoryNostrHub,
  type IInMemoryNostrHub,
  type INostrEvent,
  type INostrRelayPool,
} from '../nostr-mesh-relay.js';
import { RtcPeer } from '../rtc-peer.js';
import {
  ALL_CAPABILITIES,
  buildMeshWorld,
  type IMeshTestDevice,
  type IMeshTestWorld,
} from './mesh-fixtures.js';

import type { IMeshPeerRoute } from '../mesh-discovery.js';

const NOW = Date.now();
const EPOCH = rendezvousEpoch(NOW);
const LOCAL = '127.0.0.1';
/** TEST-NET-1 (RFC 5737): an address on another network that never answers. */
const UNREACHABLE = '192.0.2.1';

let world: IMeshTestWorld;
let stranger: IMeshTestWorld;
const cleanups: (() => unknown)[] = [];

beforeAll(async () => {
  world = await buildMeshWorld(NOW);
  stranger = await buildMeshWorld(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function routeOf(
  own: IMeshTestDevice,
  peer: IMeshTestDevice,
  of: IMeshTestWorld = world,
): Promise<IMeshPeerRoute> {
  const rendezvous = await derivePairRendezvous({
    ownKaPrivateKey: own.ka.privateKey,
    own: own.cert,
    peerDeviceId: peer.cert.deviceId,
    lists: of.identity(own),
  });
  return { deviceId: peer.cert.deviceId, ...(await rendezvous.relayInbox()), rendezvous };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const never = (): AbortSignal => new AbortController().signal;

function dhtOn(
  network: IInMemoryItemNetwork,
  options: Partial<ConstructorParameters<typeof MeshDht>[0]> = {},
): MeshDht {
  const dht = new MeshDht({
    stores: [network.store()],
    addresses: () => [LOCAL],
    maxPublishJitterMs: 0,
    ...options,
  });
  cleanups.push(() => dht.close());
  return dht;
}

/**
 * Every string that would tell whose a record is, as it would appear in plaintext. Short device
 * names are left out: random ciphertext contains them by chance.
 */
function identifying(): string[] {
  const out = ['robota', 'Robota'];
  for (const device of [world.low, world.high, world.third]) {
    out.push(device.cert.deviceId, device.cert.userId);
  }
  return out;
}

describe('rendezvous records', () => {
  it('are opaque, fixed-size, and differ per direction and per epoch', async () => {
    const network = createInMemoryItemNetwork();
    let now = NOW;
    const lowDht = dhtOn(network, {
      now: () => now,
      lists: () => ({ revocation: world.identity(world.low).revocation }),
    });
    const highDht = dhtOn(network, { now: () => now });
    const lowToHigh = await routeOf(world.low, world.high);
    const highToLow = await routeOf(world.high, world.low);

    await lowDht.advertise([lowToHigh], 4242);
    await highDht.advertise([highToLow], 4343);
    await vi.waitFor(() => expect(network.items()).toHaveLength(3));
    now += RENDEZVOUS_EPOCH_MS;
    await lowDht.advertise([lowToHigh], 4242);
    await vi.waitFor(() => expect(network.items()).toHaveLength(5));

    const items = network.items();
    // No key or salt repeats: each direction and each epoch has its own.
    expect(new Set(items.map((i) => hex(i.k))).size).toBe(items.length);
    expect(new Set(items.map((i) => hex(i.salt!))).size).toBe(items.length);
    // Every field as the bytes it carries, where a plaintext value would read as itself.
    const plain = items
      .map((i) => [i.k, i.salt!, i.v].map((b) => Buffer.from(b).toString('latin1')).join('\n'))
      .join('\n');
    // And the key and salt as hex too, where an id or a topic written as hex would show.
    const wire = `${plain}\n${items.map((i) => `${hex(i.k)}\n${hex(i.salt!)}`).join('\n')}`;
    for (const value of identifying()) expect(wire).not.toContain(value);
    for (const route of [lowToHigh, highToLow]) {
      expect(wire).not.toContain(route.inbound);
      expect(wire).not.toContain(route.outbound);
    }
    expect(plain).not.toContain(LOCAL);
    // The port as the hints encode it. Only the bytes are searched: four digits turn up in random
    // hex by chance, and a port written into a field shows in its bytes.
    expect(plain).not.toContain('4242');
    // Hints are one size whatever they hold.
    const hintSizes = new Set(items.filter((i) => i.v.length < 700).map((i) => i.v.length));
    expect([...hintSizes]).toEqual([HINTS_PADDED_BYTES + 28]);
  });

  it('are found by the peer at this epoch and the adjacent ones, and not by anyone else', async () => {
    const network = createInMemoryItemNetwork();
    const highDht = dhtOn(network, { now: () => NOW });
    await highDht.advertise([await routeOf(world.high, world.low)], 4343);
    await vi.waitFor(() => expect(network.items().length).toBeGreaterThan(0));
    const toHigh = await routeOf(world.low, world.high);

    for (const shift of [-1, 0, 1]) {
      const lowDht = dhtOn(network, { now: () => NOW + shift * RENDEZVOUS_EPOCH_MS });
      await expect(lowDht.candidates(toHigh, never())).resolves.toEqual([
        { host: LOCAL, port: 4343 },
      ]);
    }
    const later = dhtOn(network, { now: () => NOW + 2 * RENDEZVOUS_EPOCH_MS });
    await expect(later.candidates(toHigh, never())).resolves.toEqual([]);
    // The other direction, and another pair, find nothing.
    const highItself = dhtOn(network, { now: () => NOW });
    await expect(
      highItself.candidates(await routeOf(world.high, world.low), never()),
    ).resolves.toEqual([]);
    const third = dhtOn(network, { now: () => NOW });
    await expect(
      third.candidates(await routeOf(world.third, world.high), never()),
    ).resolves.toEqual([]);
  });

  it("carry the device's relay endpoints to each paired device, and to no one else", async () => {
    const network = createInMemoryItemNetwork();
    const relayEndpoint = { host: '198.51.100.7', port: 3478 };
    const highDht = dhtOn(network, { now: () => NOW, relayEndpoints: () => [relayEndpoint] });
    await highDht.advertise([await routeOf(world.high, world.low)], 4343);
    await vi.waitFor(() => expect(network.items().length).toBeGreaterThan(0));
    // Hints are one size whether or not they carry a relay.
    expect(new Set(network.items().map((i) => i.v.length))).toEqual(
      new Set([HINTS_PADDED_BYTES + 28]),
    );

    const lowDht = dhtOn(network, { now: () => NOW });
    const found = await lowDht.relayAdverts([await routeOf(world.low, world.high)], never());
    expect([...found.entries()]).toEqual([[world.high.cert.deviceId, [relayEndpoint]]]);
    // The relay's address is not an address of its signaling endpoint.
    await expect(lowDht.candidates(await routeOf(world.low, world.high), never())).resolves.toEqual(
      [{ host: LOCAL, port: 4343 }],
    );

    // A device high published nothing for learns of no relay.
    const thirdDht = dhtOn(network, { now: () => NOW });
    expect(
      (await thirdDht.relayAdverts([await routeOf(world.third, world.high)], never())).size,
    ).toBe(0);
  });

  it('a relay lookup is not repeated on every attempt: found or not, the answer is kept a while', async () => {
    const network = createInMemoryItemNetwork();
    const inner = network.store();
    let reads = 0;
    const counting: IRendezvousItemStore = {
      put: (...args) => inner.put(...args),
      get: (...args) => {
        reads += 1;
        return inner.get(...args);
      },
      close: () => inner.close(),
    };
    let now = NOW;
    const lowDht = dhtOn(network, { now: () => now, stores: [counting] });
    const toHigh = [await routeOf(world.low, world.high)];

    expect((await lowDht.relayAdverts(toHigh, never())).size).toBe(0);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    expect((await lowDht.relayAdverts(toHigh, never())).size).toBe(0);
    expect(reads).toBe(afterFirst);

    // "No relay" is checked again after a while: the peer may have started one since.
    const highDht = dhtOn(network, {
      now: () => now,
      relayEndpoints: () => [{ host: '198.51.100.7', port: 3478 }],
    });
    await highDht.advertise([await routeOf(world.high, world.low)], 4343);
    await vi.waitFor(() => expect(network.items().length).toBeGreaterThan(0));
    now += 3 * 60 * 1000;
    expect((await lowDht.relayAdverts(toHigh, never())).size).toBe(1);
    const afterFound = reads;
    expect((await lowDht.relayAdverts(toHigh, never())).size).toBe(1);
    expect(reads).toBe(afterFound);
  });

  it('a tampered record, one signed by another key, or another pair’s record is rejected', async () => {
    const network = createInMemoryItemNetwork();
    const highDht = dhtOn(network, { now: () => NOW });
    const thirdDht = dhtOn(network, { now: () => NOW });
    await highDht.advertise([await routeOf(world.high, world.low)], 4343);
    await thirdDht.advertise([await routeOf(world.third, world.low)], 4444);
    await vi.waitFor(() => expect(network.items()).toHaveLength(2));
    const toHigh = await routeOf(world.low, world.high);
    const lowDht = dhtOn(network, { now: () => NOW });
    const address = await itemAddress(toHigh.rendezvous, 'hints', 'inbound', EPOCH);
    const genuine = network.items().find((i) => hex(i.k) === hex(address.key.publicKey))!;
    const thirds = network.items().find((i) => i !== genuine)!;

    // A byte of the value flipped by a node.
    network.serve((item) => {
      const v = new Uint8Array(item.v);
      v[v.length - 1]! ^= 1;
      return { ...item, v };
    });
    await expect(lowDht.candidates(toHigh, never())).resolves.toEqual([]);

    // A node that re-signs a value under its own key.
    const foreign = await ed25519FromSeed(new Uint8Array(32).fill(7));
    const forged = await signMutableItem(foreign, genuine.salt, genuine.seq, genuine.v);
    network.serve(() => forged);
    await expect(lowDht.candidates(toHigh, never())).resolves.toEqual([]);

    // Another pair's valid record served in its place.
    network.serve(() => thirds);
    await expect(lowDht.candidates(toHigh, never())).resolves.toEqual([]);

    network.serve((item) => item);
    await expect(lowDht.candidates(toHigh, never())).resolves.toEqual([
      { host: LOCAL, port: 4343 },
    ]);
  });

  it('publish times are jittered per pair, within the bound', async () => {
    const realSleep = setTimeout;
    const settle = (): Promise<void> => new Promise((resolve) => realSleep(resolve, 50));
    vi.useFakeTimers({ now: NOW });
    const network = createInMemoryItemNetwork();
    const store = network.store();
    const at: number[] = [];
    const spy: IRendezvousItemStore = {
      put: (address, value, now) => {
        at.push(Date.now() - NOW);
        return store.put(address, value, now);
      },
      get: store.get,
      close: () => undefined,
    };
    const draws = [0.25, 0.9];
    const dht = new MeshDht({
      stores: [spy],
      addresses: () => [LOCAL],
      maxPublishJitterMs: 10_000,
      random: () => draws.shift() ?? 0,
    });
    cleanups.push(() => dht.close());
    await dht.advertise(
      [await routeOf(world.low, world.high), await routeOf(world.low, world.third)],
      4242,
    );
    await vi.advanceTimersByTimeAsync(2_499);
    await settle();
    expect(at).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(at).toEqual([2_500]);
    await vi.advanceTimersByTimeAsync(6_499);
    await settle();
    expect(at).toEqual([2_500]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(at).toEqual([2_500, 9_000]);

    expect(publishJitter(10_000, () => 0)).toBe(0);
    expect(publishJitter(10_000, () => 0.9999)).toBeLessThanOrEqual(10_000);
    expect(publishJitter(10_000, () => 5)).toBe(10_000);
    expect(publishJitter(10_000, () => -1)).toBe(0);
    expect(publishJitter(10_000, () => Number.NaN)).toBe(0);
  });

  it('hand on the newest device lists a peer published, for the freshness lookup', async () => {
    const network = createInMemoryItemNetwork();
    const newer = await world.revoking(world.third);
    const highDht = dhtOn(network, {
      now: () => NOW,
      lists: () => ({ revocation: newer }),
    });
    await highDht.advertise([await routeOf(world.high, world.low)], 4343);
    await vi.waitFor(() => expect(network.items()).toHaveLength(2));
    const lowDht = dhtOn(network, { now: () => NOW });
    await lowDht.advertise([await routeOf(world.low, world.high)], 4242);

    await expect(lowDht.latestLists(never())).resolves.toEqual({
      revocation: [JSON.parse(JSON.stringify(newer))],
    });
  });

  it('hand on every list candidate newest first, and a list too large for one record in chunks', async () => {
    const network = createInMemoryItemNetwork();
    const many = await issueDeviceRevocationList({
      signingKey: world.signingKey,
      seq: 12,
      issuedAt: NOW,
      revokedDeviceIds: Array.from({ length: 40 }, (_, i) =>
        Buffer.alloc(32, i + 1).toString('base64url'),
      ),
    });
    const forged = { ...many, seq: Number.MAX_SAFE_INTEGER, revokedDeviceIds: [] };
    const highDht = dhtOn(network, { now: () => NOW, lists: () => ({ revocation: many }) });
    const thirdDht = dhtOn(network, { now: () => NOW, lists: () => ({ revocation: forged }) });
    await highDht.advertise([await routeOf(world.high, world.low)], 4343);
    await thirdDht.advertise([await routeOf(world.third, world.low)], 4444);
    // Hints and one list chunk from third; hints and several list chunks from high.
    await vi.waitFor(() => expect(network.items().length).toBeGreaterThan(5));
    const lowDht = dhtOn(network, { now: () => NOW });
    await lowDht.advertise(
      [await routeOf(world.low, world.high), await routeOf(world.low, world.third)],
      4242,
    );

    const found = await lowDht.latestLists(never());
    expect(found?.revocation).toEqual([
      JSON.parse(JSON.stringify(forged)),
      JSON.parse(JSON.stringify(many)),
    ]);
    // Every chunk is one fixed size.
    expect(
      new Set(
        network
          .items()
          .filter((i) => i.v.length > 700)
          .map((i) => i.v.length),
      ).size,
    ).toBe(1);
  });

  it('a paired device that publishes many lists cannot crowd out the one another device published', async () => {
    const networks = Array.from({ length: 6 }, () => createInMemoryItemNetwork());
    const genuine = await world.revoking(world.third);
    const toLowFromHigh = await routeOf(world.high, world.low);
    const toLowFromThird = await routeOf(world.third, world.low);
    const highDht = new MeshDht({
      stores: networks.map((n) => n.store()),
      addresses: () => [LOCAL],
      maxPublishJitterMs: 0,
      now: () => NOW,
      lists: () => ({ revocation: genuine }),
    });
    cleanups.push(() => highDht.close());
    await highDht.advertise([toLowFromHigh], 4343);
    // `third` publishes a different list claiming a higher seq to every store, in every epoch read.
    let forged = 0;
    for (const skew of [-1, 0, 1]) {
      for (const network of networks) {
        forged += 1;
        const claim = { ...genuine, seq: Number.MAX_SAFE_INTEGER - forged };
        const dht = dhtOn(network, {
          now: () => NOW + skew * RENDEZVOUS_EPOCH_MS,
          lists: () => ({ revocation: claim }),
        });
        await dht.advertise([toLowFromThird], 4444);
      }
    }
    // Hints and one list chunk per store from high, and per store and epoch from third.
    await vi.waitFor(() =>
      expect(networks.reduce((n, net) => n + net.items().length, 0)).toBe(12 + 36),
    );
    const lowDht = new MeshDht({
      stores: networks.map((n) => n.store()),
      addresses: () => [LOCAL],
      maxPublishJitterMs: 0,
      now: () => NOW,
    });
    cleanups.push(() => lowDht.close());
    await lowDht.advertise(
      [await routeOf(world.low, world.high), await routeOf(world.low, world.third)],
      4242,
    );

    const found = await lowDht.latestLists(never());
    expect(found?.revocation).toContainEqual(JSON.parse(JSON.stringify(genuine)));
  });

  it('a read that finds the chunks of two versions of a list yields no list', async () => {
    const ids = (fill: number): string[] =>
      Array.from({ length: 40 }, (_, i) => Buffer.alloc(32, fill + i).toString('base64url'));
    const older = await issueDeviceRevocationList({
      signingKey: world.signingKey,
      seq: 12,
      issuedAt: NOW,
      revokedDeviceIds: ids(1),
    });
    const newer = await issueDeviceRevocationList({
      signingKey: world.signingKey,
      seq: 13,
      issuedAt: NOW,
      revokedDeviceIds: ids(101),
    });
    const toLow = await routeOf(world.high, world.low);
    const before = createInMemoryItemNetwork();
    const after = createInMemoryItemNetwork();
    await dhtOn(before, { now: () => NOW, lists: () => ({ revocation: older }) }).advertise(
      [toLow],
      4343,
    );
    await dhtOn(after, { now: () => NOW, lists: () => ({ revocation: newer }) }).advertise(
      [toLow],
      4343,
    );
    await vi.waitFor(() => {
      expect(before.items().length).toBeGreaterThan(2);
      expect(after.items()).toHaveLength(before.items().length);
    });
    // The first chunk is already the newer version's; the others are still the older one's.
    const first = await itemAddress(toLow.rendezvous, 'revocation', 'outbound', EPOCH, 0);
    const firstKey = hex(first.key.publicKey);
    before.serve((item) =>
      hex(item.k) === firstKey ? after.items().find((i) => hex(i.k) === firstKey) : item,
    );
    const lowDht = dhtOn(before, { now: () => NOW });
    await lowDht.advertise([await routeOf(world.low, world.high)], 4242);

    await expect(lowDht.latestLists(never())).resolves.toBeUndefined();
  });
});

describe('pkarr relays', () => {
  it('carry the salt-less form of a record, and a relay cannot forge or tamper with one', async () => {
    const held = new Map<string, Uint8Array>();
    let tamper = false;
    const relay = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT') {
        held.set(url, new Uint8Array(init.body as ArrayBuffer));
        return new Response(null, { status: 204 });
      }
      const body = held.get(url);
      if (body === undefined) return new Response(null, { status: 404 });
      const served = new Uint8Array(body);
      if (tamper) served[served.length - 1]! ^= 1;
      return new Response(served, { status: 200 });
    }) as typeof fetch;
    const store = createPkarrRelayStore({
      relays: ['https://one.example', 'https://two.example/'],
      fetch: relay,
    });
    const route = await routeOf(world.low, world.high);
    const address = await itemAddress(route.rendezvous, 'hints', 'outbound', EPOCH);
    const value = new Uint8Array(668).fill(9);
    await store.put(address, value, NOW);

    expect(held.size).toBe(2);
    const body = [...held.values()][0]!;
    const packet = body.subarray(72);
    const seq = Number(new DataView(body.buffer, 64, 8).getBigUint64(0));
    expect(seq).toBe(NOW * 1000);
    expect(body.length).toBeLessThanOrEqual(64 + 8 + 1000);
    expect(decodePkarrPacket(packet)).toEqual(value);
    expect(await store.get(address.key.publicKey, address.salt, never())).toEqual(value);
    // The signature covers exactly the salt-less item.
    expect(hex(await address.key.sign(bep44SignedBytes(undefined, seq, packet)))).toBe(
      hex(body.subarray(0, 64)),
    );

    tamper = true;
    await expect(store.get(address.key.publicKey, address.salt, never())).resolves.toBeUndefined();
    const other = await ed25519FromSeed(new Uint8Array(32).fill(3));
    tamper = false;
    await expect(store.get(other.publicKey, address.salt, never())).resolves.toBeUndefined();
    expect(decodePkarrPacket(encodePkarrPacket(other.publicKey, new Uint8Array(0)))).toEqual(
      new Uint8Array(0),
    );
  });
});

describe('the Mainline DHT store', () => {
  it('puts a salted BEP 44 item and rejects what a node tampered with', async () => {
    let stored: { k: Buffer; salt: Buffer; seq: number; v: Buffer; sig: Buffer } | undefined;
    let tamper = false;
    const fake: IMainlineDht = {
      put: (item, callback) => {
        stored = item;
        callback(null, Buffer.alloc(20), 8);
      },
      get: (_target, _options, callback) => {
        if (stored === undefined) return callback(null, null);
        const v = Buffer.from(stored.v);
        if (tamper) v[0]! ^= 1;
        callback(null, { ...stored, v });
      },
      on: () => undefined,
      destroy: () => undefined,
    };
    const store = await startMainlineDhtStore({ createDht: () => fake });
    const route = await routeOf(world.low, world.high);
    const address = await itemAddress(route.rendezvous, 'hints', 'outbound', EPOCH);
    const value = new Uint8Array(100).fill(5);
    await store.put(address, value, NOW);
    expect(hex(stored!.salt)).toBe(hex(address.salt));
    expect(stored!.seq).toBe(Math.floor(NOW / 1000));
    await expect(store.get(address.key.publicKey, address.salt, never())).resolves.toEqual(
      new Uint8Array(value),
    );
    tamper = true;
    await expect(store.get(address.key.publicKey, address.salt, never())).resolves.toBeUndefined();
    store.close();
  });
});

describe('Nostr signaling', () => {
  function nostrOn(hub: IInMemoryNostrHub, now: () => number = () => Date.now()): NostrMeshRelay {
    const relay = new NostrMeshRelay({ pool: hub.pool(), now });
    cleanups.push(() => relay.close());
    return relay;
  }

  it('events carry only ciphertext under keys and kinds that rotate per direction and epoch', async () => {
    const hub = createInMemoryNostrHub();
    let now = NOW;
    const low = nostrOn(hub, () => now);
    const high = nostrOn(hub, () => now);
    const toHigh = await routeOf(world.low, world.high);
    const toLow = await routeOf(world.high, world.low);
    low.declarePeers([toHigh]);
    high.declarePeers([toLow]);
    await high.whenIdle();
    const received: [string, unknown][] = [];
    high.onMessage((topic, data) => received.push([topic, data]));
    const signal = { v: 1, kind: 'hello', from: 'SECRETINSTANCEIDxxxxxx' };

    low.send(toHigh.outbound, signal);
    await vi.waitFor(() => expect(received).toEqual([[toLow.inbound, signal]]));
    high.send(toLow.outbound, signal);
    await vi.waitFor(() => expect(hub.events).toHaveLength(2));
    now += RENDEZVOUS_EPOCH_MS;
    low.declarePeers([toHigh]);
    high.declarePeers([toLow]);
    await high.whenIdle();
    low.send(toHigh.outbound, signal);
    await vi.waitFor(() => expect(received).toHaveLength(2));

    const events = hub.events;
    expect(new Set(events.map((e) => e.pubkey)).size).toBe(3);
    for (const event of events) {
      expect(event.kind).toBeGreaterThanOrEqual(20_000);
      expect(event.kind).toBeLessThan(30_000);
      expect(event.tags).toEqual([]);
      const plain = Buffer.from(event.content, 'base64').toString('latin1');
      expect(plain).not.toContain('SECRETINSTANCEID');
      expect(plain).not.toContain('hello');
    }
    const wire = JSON.stringify(events);
    for (const value of identifying()) expect(wire).not.toContain(value);
    for (const topic of [toHigh.inbound, toHigh.outbound]) expect(wire).not.toContain(topic);
  });

  it('drops forged, tampered, replayed, stale and duplicate events', async () => {
    const hub = createInMemoryNostrHub();
    const low = nostrOn(hub);
    const high = nostrOn(hub);
    const toHigh = await routeOf(world.low, world.high);
    low.declarePeers([toHigh]);
    high.declarePeers([await routeOf(world.high, world.low)]);
    await high.whenIdle();
    const received: unknown[] = [];
    high.onMessage((_topic, data) => received.push(data));
    low.send(toHigh.outbound, { n: 1 });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const genuine = hub.events[0]!;

    // The same event again (another relay, or a replay).
    hub.inject(genuine);
    // Content changed: the id and signature no longer match.
    hub.inject({ ...genuine, content: Buffer.from('forged').toString('base64') });
    // A stale event, re-signed by the pair's key: still too old.
    const secretKey = await toHigh.rendezvous.signingSeed('outbound', EPOCH, 'signal');
    const { finalizeEvent } = await import('nostr-tools/pure');
    hub.inject(
      finalizeEvent(
        {
          kind: genuine.kind,
          created_at: genuine.created_at - 3_600,
          tags: [],
          content: genuine.content,
        },
        secretKey,
      ),
    );
    // A valid event by a key that is not the pair's.
    hub.inject(
      finalizeEvent(
        { kind: genuine.kind, created_at: genuine.created_at, tags: [], content: genuine.content },
        new Uint8Array(32).fill(1),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual([{ n: 1 }]);
  });
});

// ── End to end, two devices, through in-process fakes ──────────────────────────────────────────

interface IInternetDevice {
  readonly node: DeviceMeshNode;
  readonly relay: DiscoveringMeshRelay;
  readonly dht: MeshDht;
  readonly sent: string[];
}

async function internetDevice(
  device: IMeshTestDevice,
  options: {
    readonly network: IInMemoryItemNetwork;
    readonly nostr?: INostrRelayPool;
    readonly relay?: IMeshRelay;
    /** What this device publishes as its addresses. */
    readonly addresses: readonly string[];
    readonly dht?: Partial<ConstructorParameters<typeof MeshDht>[0]>;
    readonly freshness?: boolean;
    readonly identity?: ReturnType<IMeshTestWorld['identity']>;
    readonly admissionTimeoutMs?: number;
  },
): Promise<IInternetDevice> {
  const listener = await startMeshLanListener({ host: LOCAL });
  const dht = new MeshDht({
    stores: [options.network.store()],
    addresses: () => options.addresses,
    maxPublishJitterMs: 0,
    ...options.dht,
  });
  const nostr =
    options.nostr !== undefined ? new NostrMeshRelay({ pool: options.nostr }) : undefined;
  const sent: string[] = [];
  const relay = new DiscoveringMeshRelay({
    ...(options.relay !== undefined ? { relay: options.relay } : {}),
    ...(nostr !== undefined ? { signaling: [nostr] } : {}),
    listener,
    sources: [dht],
    advertisers: [dht],
    probeTimeoutMs: 500,
    ...(options.admissionTimeoutMs !== undefined
      ? { admissionTimeoutMs: options.admissionTimeoutMs }
      : {}),
  });
  const node = new DeviceMeshNode({
    identity: options.identity ?? world.identity(device),
    sessionDescriptor: device.session,
    localPolicy: ALL_CAPABILITIES,
    relay,
    connectTimeoutMs: 15_000,
    ...(options.freshness === true
      ? { fetchLatestLists: (signal) => dht.latestLists(signal) }
      : {}),
  });
  cleanups.push(
    () => node.stop(),
    () => relay.close(),
    () => nostr?.close(),
  );
  return { node, relay, dht, sent };
}

function nextMessage(link: IDeviceMeshLink): Promise<string> {
  return new Promise((resolve) => {
    const off = link.onMessage((body) => {
      off();
      resolve(body);
    });
  });
}

describe('two devices beyond the local network', () => {
  it('find each other in DHT records and connect directly', async () => {
    const network = createInMemoryItemNetwork();
    const high = await internetDevice(world.high, { network, addresses: [LOCAL] });
    await high.node.start();
    await vi.waitFor(() => expect(network.items().length).toBeGreaterThan(0));
    const low = await internetDevice(world.low, { network, addresses: [LOCAL] });
    await low.node.start();

    const [atLow, atHigh] = await Promise.all([
      low.node.connect(world.high.cert.deviceId),
      high.node.connect(world.low.cert.deviceId),
    ]);
    expect(atLow.admission.deviceId).toBe(world.high.cert.deviceId);
    const received = nextMessage(atHigh);
    atLow.send('found through the DHT');
    await expect(received).resolves.toBe('found through the DHT');
  }, 40_000);

  it('on two networks whose addresses do not reach each other, Nostr carries the signaling', async () => {
    const network = createInMemoryItemNetwork();
    const hub = createInMemoryNostrHub();
    const high = await internetDevice(world.high, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
    });
    const low = await internetDevice(world.low, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
    });
    await Promise.all([low.node.start(), high.node.start()]);

    const [atLow, atHigh] = await Promise.all([
      low.node.connect(world.high.cert.deviceId, 30_000),
      high.node.connect(world.low.cert.deviceId, 30_000),
    ]);
    const received = nextMessage(atHigh);
    atLow.send('signaled over Nostr');
    await expect(received).resolves.toBe('signaled over Nostr');

    // What the relays saw names no device and none of the pair's relay inbox topics.
    const wire = JSON.stringify(hub.events);
    expect(hub.events.length).toBeGreaterThan(2);
    for (const value of identifying()) expect(wire).not.toContain(value);
    const route = await routeOf(world.low, world.high);
    expect(wire).not.toContain(route.inbound);
    expect(wire).not.toContain(route.outbound);
  }, 60_000);

  it('Nostr relays that drop signals are set aside for the self-hosted relay', async () => {
    const network = createInMemoryItemNetwork();
    const silent: INostrRelayPool = {
      publish: () => Promise.resolve(true),
      subscribe: () => ({ close: () => undefined }),
      close: () => undefined,
    };
    const hub = createInMemoryMeshRelayHub();
    const options = {
      network,
      nostr: silent,
      addresses: [UNREACHABLE],
      admissionTimeoutMs: 1_500,
    } as const;
    const high = await internetDevice(world.high, { ...options, relay: hub.connect() });
    const low = await internetDevice(world.low, { ...options, relay: hub.connect() });
    await Promise.all([low.node.start(), high.node.start()]);

    await expect
      .poll(
        async () => {
          const [a] = await Promise.allSettled([
            low.node.connect(world.high.cert.deviceId, 4_000),
            high.node.connect(world.low.cert.deviceId, 4_000),
          ]);
          return a.status;
        },
        { timeout: 40_000, interval: 200 },
      )
      .toBe('fulfilled');
  }, 60_000);

  it('a discovery result grants nothing: a stranger holding the pair’s public keys is refused', async () => {
    // The strongest discovery attacker: it has the pair's Nostr keys (as if a relay could compute
    // them) and answers as the peer, with a device of another roster.
    const network = createInMemoryItemNetwork();
    const hub = createInMemoryNostrHub();
    const low = await internetDevice(world.low, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
    });
    const attacker = new NostrMeshRelay({ pool: hub.pool() });
    cleanups.push(() => attacker.close());
    const asHigh = await routeOf(world.high, world.low);
    attacker.declarePeers([asHigh]);
    const instance = 'AAAAAAAAAAAAAAAAAAAAAA';
    const impostor = stranger.high;
    let rogue: MeshPeerLink | undefined;
    attacker.onMessage((_topic, data) => {
      const signal = data as { kind: string; from: string; cid: string; sdp?: string };
      if (signal.kind === 'hello') {
        attacker.send(asHigh.outbound, { v: 1, kind: 'hello', from: instance });
      } else if (signal.kind === 'offer') {
        rogue = new MeshPeerLink({
          role: 'answerer',
          createPeer: () => new RtcPeer(),
          sendSignal: (s) =>
            attacker.send(asHigh.outbound, {
              v: 1,
              from: instance,
              to: signal.from,
              cid: signal.cid,
              ...s,
            }),
          startHandshake: (binding) =>
            startDeviceHandshake({
              role: 'responder',
              identity: stranger.identity(impostor),
              sessionDescriptor: impostor.session,
              localFingerprint: binding.localFingerprint,
              remoteFingerprint: binding.remoteFingerprint,
              locality: 'another-host',
              localPolicy: ALL_CAPABILITIES,
              send: binding.send,
            }),
          connectTimeoutMs: 15_000,
          onAdmitted: () => undefined,
          onEnded: () => undefined,
        });
        cleanups.push(() => rogue?.close());
        rogue.onSignal({ kind: 'offer', sdp: signal.sdp! });
      } else if (signal.kind === 'ice') {
        rogue?.onSignal({ kind: 'ice', candidate: (data as { candidate: never }).candidate });
      }
    });
    const admitted: IDeviceMeshLink[] = [];
    const refusals: string[] = [];
    low.node.onLink((link) => admitted.push(link));
    low.node.onRefusal((refusal) => refusals.push(refusal.end));
    await low.node.start();
    const attempt = low.node.connect(world.high.cert.deviceId, 25_000).then(
      () => 'admitted',
      () => 'refused',
    );

    await expect.poll(() => refusals.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(rogue).toBeDefined();
    await expect(attempt).resolves.toBe('refused');
    expect(admitted).toEqual([]);
  }, 60_000);

  it('a revocation published by another device is seen before admission, and the revoked device is refused even when it publishes a forged newer list', async () => {
    const network = createInMemoryItemNetwork();
    const hub = createInMemoryNostrHub();
    const revokingThird = await world.revoking(world.third);
    // high holds the newer list and hands it on; low has not seen it.
    const high = await internetDevice(world.high, {
      network,
      addresses: [UNREACHABLE],
      identity: world.identity(world.high, { revocation: revokingThird }),
      dht: { lists: () => ({ revocation: revokingThird }) },
    });
    await high.node.start();
    await vi.waitFor(() =>
      expect(network.items().some((i) => i.v.length > HINTS_PADDED_BYTES + 28)).toBe(true),
    );
    const low = await internetDevice(world.low, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
      freshness: true,
    });
    // The device being revoked publishes a forged "newer" list to hide the real one.
    const forged = { ...revokingThird, seq: Number.MAX_SAFE_INTEGER, revokedDeviceIds: [] };
    const third = await internetDevice(world.third, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
      dht: { lists: () => ({ revocation: forged }) },
    });
    const admitted: IDeviceMeshLink[] = [];
    low.node.onLink((link) => admitted.push(link));
    await Promise.all([low.node.start(), third.node.start()]);

    const results = await Promise.allSettled([
      low.node.connect(world.third.cert.deviceId, 25_000),
      third.node.connect(world.low.cert.deviceId, 25_000),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(admitted).toEqual([]);
    // low adopted the newer list, and dropped the revoked device.
    expect(low.node.roleFor(world.third.cert.deviceId)).toBeUndefined();
  }, 60_000);

  it('without the freshness lookup the same device would have been admitted', async () => {
    const network = createInMemoryItemNetwork();
    const hub = createInMemoryNostrHub();
    const low = await internetDevice(world.low, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
    });
    const third = await internetDevice(world.third, {
      network,
      nostr: hub.pool(),
      addresses: [UNREACHABLE],
    });
    await Promise.all([low.node.start(), third.node.start()]);
    const [atLow] = await Promise.all([
      low.node.connect(world.third.cert.deviceId, 25_000),
      third.node.connect(world.low.cert.deviceId, 25_000),
    ]);
    expect(atLow.admission.deviceId).toBe(world.third.cert.deviceId);
  }, 60_000);
});
