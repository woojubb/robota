import { createServer } from 'node:net';
import { hostname } from 'node:os';

import {
  RENDEZVOUS_EPOCH_MS,
  derivePairRendezvous,
  rendezvousEpoch,
  startDeviceHandshake,
  type IPairRendezvous,
} from '@robota-sdk/agent-remote-pairing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { DeviceMeshNode, type IDeviceMeshLink } from '../device-mesh-node.js';
import { DiscoveringMeshRelay } from '../discovering-mesh-relay.js';
import {
  addressCacheSource,
  createInMemoryMeshAddressCache,
  type IMeshAddressCache,
  type IMeshCandidate,
  type IMeshCandidateSource,
  type IMeshPeerRoute,
} from '../mesh-discovery.js';
import {
  lanAddressOf,
  startMeshLanListener,
  verifyLanPresenceProof,
  type IMeshLanListener,
} from '../mesh-lan-listener.js';
import {
  MESH_MDNS_SERVICE,
  MeshMdns,
  createInMemoryMdnsBus,
  type IInMemoryMdnsBus,
  type IMdnsPacket,
} from '../mesh-mdns.js';
import { createInMemoryMeshRelayHub, type IMeshRelay } from '../mesh-relay.js';
import { MeshPeerLink, type TMeshLinkEnd } from '../mesh-peer-link.js';
import { RtcPeer } from '../rtc-peer.js';
import {
  ALL_CAPABILITIES,
  buildMeshWorld,
  type IMeshTestDevice,
  type IMeshTestWorld,
} from './mesh-fixtures.js';

import type { IWebSocketLike } from '../ws-signaling-client.js';

const NOW = Date.now();
const LOCAL = '127.0.0.1';

let world: IMeshTestWorld;
let stranger: IMeshTestWorld;
const cleanups: (() => unknown)[] = [];

beforeAll(async () => {
  world = await buildMeshWorld(NOW);
  // Another roster under another signing key: none of its devices is on `world`'s lists.
  stranger = await buildMeshWorld(NOW);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function routeOf(own: IMeshTestDevice, peer: IMeshTestDevice): Promise<IMeshPeerRoute> {
  const rendezvous = await derivePairRendezvous({
    ownKaPrivateKey: own.ka.privateKey,
    own: own.cert,
    peerDeviceId: peer.cert.deviceId,
    lists: world.identity(own),
  });
  const topics = await rendezvous.relayInbox();
  return { deviceId: peer.cert.deviceId, ...topics, rendezvous };
}

function mdnsOn(
  bus: IInMemoryMdnsBus,
  address: string,
  now: () => number = () => NOW,
  lookupTimeoutMs = 300,
): MeshMdns {
  const mdns = new MeshMdns({
    createTransport: () => bus.transport(address),
    addresses: () => [address],
    lookupTimeoutMs,
    minAnswerIntervalMs: 0,
    now,
  });
  cleanups.push(() => mdns.close());
  return mdns;
}

function lookup(mdns: MeshMdns, route: IMeshPeerRoute): Promise<readonly IMeshCandidate[]> {
  return mdns.candidates(route, new AbortController().signal);
}

const ptrs = (packet: IMdnsPacket) => (packet.answers ?? []).filter((r) => r.type === 'PTR');

function fakeRoute(index: number): IMeshPeerRoute {
  const tag = (): Promise<Uint8Array> => {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Promise.resolve(bytes);
  };
  return {
    deviceId: `device-${index}`,
    inbound: `in-${index}`,
    outbound: `out-${index}`,
    rendezvous: { tag } as unknown as IPairRendezvous,
  };
}

describe('mDNS announcement', () => {
  it('names neither the product, nor a device, nor the machine', async () => {
    const bus = createInMemoryMdnsBus();
    const mdns = mdnsOn(bus, '10.0.0.1');
    await mdns.advertise(
      [await routeOf(world.low, world.high), await routeOf(world.low, world.third)],
      4242,
    );

    const announced = JSON.stringify(bus.responses).toLowerCase();
    expect(announced).not.toContain('robota');
    for (const device of [world.low, world.high, world.third]) {
      expect(announced).not.toContain(device.cert.deviceId.toLowerCase());
      expect(announced).not.toContain(device.cert.name.toLowerCase());
    }
    expect(announced).not.toContain(hostname().toLowerCase());
    expect(MESH_MDNS_SERVICE.toLowerCase()).not.toContain('robota');
    for (const ptr of ptrs(bus.responses[0]!)) {
      expect(ptr.name).toBe(MESH_MDNS_SERVICE);
      expect(ptr.data).toMatch(
        new RegExp(`^[0-9a-f]{32}\\.${MESH_MDNS_SERVICE.replace(/\./g, '\\.')}$`),
      );
    }
  });

  it('pads the instance count, so the answer does not tell how many devices there are', async () => {
    const counts: number[] = [];
    for (const peers of [0, 1, 2, 7, 8, 9]) {
      const bus = createInMemoryMdnsBus();
      const mdns = mdnsOn(bus, '10.0.0.1');
      await mdns.advertise(
        Array.from({ length: peers }, (_, i) => fakeRoute(i)),
        4242,
      );
      counts.push(ptrs(bus.responses[0]!).length);
    }
    expect(counts).toEqual([8, 8, 8, 8, 8, 16]);
  });

  it('changes every name each epoch', async () => {
    let clock = NOW;
    const bus = createInMemoryMdnsBus();
    const mdns = mdnsOn(bus, '10.0.0.1', () => clock);
    const route = await routeOf(world.low, world.high);
    await mdns.advertise([route], 4242);
    clock += RENDEZVOUS_EPOCH_MS;
    await mdns.advertise([route], 4242);
    const [first, second] = bus.responses.map((packet) => JSON.stringify(packet));
    const names = (json: string | undefined) => new Set(json?.match(/[0-9a-f]{32}/g));
    const overlap = [...names(first)].filter((name) => names(second).has(name));
    expect(overlap).toEqual([]);
  });
});

describe('mDNS announcement within one epoch', () => {
  it('keeps its padding, so two answers from one epoch do not single out the real names', async () => {
    const bus = createInMemoryMdnsBus();
    const mdns = mdnsOn(bus, '10.0.0.1');
    const toHigh = await routeOf(world.low, world.high);
    await mdns.advertise([toHigh], 4242);
    await mdns.advertise([toHigh], 4242);
    // Nothing changed: nothing is announced again.
    expect(bus.responses).toHaveLength(1);
    await mdns.advertise([toHigh, await routeOf(world.low, world.third)], 4242);
    expect(bus.responses).toHaveLength(2);
    const names = (packet: IMdnsPacket) => new Set(ptrs(packet).map((r) => String(r.data)));
    const [first, second] = bus.responses.map(names);
    const common = [...first!].filter((name) => second!.has(name));
    // One real name is common to both; the rest of the common names are padding.
    expect(common.length).toBe(7);
  });

  it('answers a flood of queries a bounded number of times', async () => {
    const bus = createInMemoryMdnsBus();
    const mdns = new MeshMdns({
      createTransport: () => bus.transport('10.0.0.1'),
      addresses: () => ['10.0.0.1'],
    });
    cleanups.push(() => mdns.close());
    await mdns.advertise([await routeOf(world.low, world.high)], 4242);
    const flooder = bus.transport('10.0.0.9');
    cleanups.push(() => flooder.destroy());
    for (let i = 0; i < 50; i += 1) {
      flooder.query({ questions: [{ name: MESH_MDNS_SERVICE, type: 'PTR' }] });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The announcement, and at most one answer so far.
    expect(bus.responses.length).toBeLessThanOrEqual(2);
  });
});

describe('mDNS lookup', () => {
  it('finds the peer at the address that answered, in the adjacent epochs too, and nothing two epochs away', async () => {
    const bus = createInMemoryMdnsBus();
    await mdnsOn(bus, '10.0.0.1').advertise([await routeOf(world.low, world.high)], 4242);
    const toLow = await routeOf(world.high, world.low);

    for (const skew of [-1, 0, 1]) {
      const high = mdnsOn(bus, '10.0.0.2', () => NOW + skew * RENDEZVOUS_EPOCH_MS);
      await expect(lookup(high, toLow)).resolves.toEqual([{ host: '10.0.0.1', port: 4242 }]);
    }
    const far = mdnsOn(bus, '10.0.0.2', () => NOW + 2 * RENDEZVOUS_EPOCH_MS);
    await expect(lookup(far, toLow)).resolves.toEqual([]);
  });

  it('keeps the directions apart: a device does not find its own announcement, and another pair finds nothing', async () => {
    const bus = createInMemoryMdnsBus();
    const low = mdnsOn(bus, '10.0.0.1');
    await low.advertise([await routeOf(world.low, world.high)], 4242);

    // low announces dir(low → high); looking up dir(high → low) finds no one, since high is silent.
    await expect(lookup(low, await routeOf(world.low, world.high))).resolves.toEqual([]);
    const third = mdnsOn(bus, '10.0.0.3');
    await expect(lookup(third, await routeOf(world.third, world.low))).resolves.toEqual([]);
  });
});

/** A socket factory that records every frame this device sends on the local network. */
function recordingConnect(sent: string[]): (candidate: IMeshCandidate) => IWebSocketLike {
  return (candidate) => {
    const socket = new WebSocket(`ws://${candidate.host}:${candidate.port}`);
    return {
      get readyState() {
        return socket.readyState;
      },
      send(data: string) {
        sent.push(data);
        socket.send(data);
      },
      close() {
        socket.close();
      },
      on(event, handler) {
        socket.on(event, handler as never);
      },
    };
  };
}

interface ILanDevice {
  readonly node: DeviceMeshNode;
  readonly listener: IMeshLanListener;
  readonly cache: IMeshAddressCache;
  readonly mdns?: MeshMdns;
  readonly sent: string[];
}

async function lanDevice(
  device: IMeshTestDevice,
  options: {
    readonly bus?: IInMemoryMdnsBus;
    readonly relay?: IMeshRelay;
    readonly extraSources?: readonly IMeshCandidateSource[];
    readonly cache?: IMeshAddressCache;
    readonly admissionTimeoutMs?: number;
    readonly connectTimeoutMs?: number;
  } = {},
): Promise<ILanDevice> {
  const listener = await startMeshLanListener({ host: LOCAL });
  const cache = options.cache ?? createInMemoryMeshAddressCache();
  const mdns = options.bus !== undefined ? mdnsOn(options.bus, LOCAL) : undefined;
  const sent: string[] = [];
  const relay = new DiscoveringMeshRelay({
    ...(options.relay !== undefined ? { relay: options.relay } : {}),
    listener,
    sources: [
      addressCacheSource(cache),
      ...(mdns !== undefined ? [mdns] : []),
      ...(options.extraSources ?? []),
    ],
    cache,
    ...(mdns !== undefined ? { advertisers: [mdns] } : {}),
    connect: recordingConnect(sent),
    probeTimeoutMs: 500,
    ...(options.admissionTimeoutMs !== undefined
      ? { admissionTimeoutMs: options.admissionTimeoutMs }
      : {}),
  });
  const node = new DeviceMeshNode({
    identity: world.identity(device),
    sessionDescriptor: device.session,
    localPolicy: ALL_CAPABILITIES,
    relay,
    connectTimeoutMs: options.connectTimeoutMs ?? 15_000,
  });
  cleanups.push(
    () => node.stop(),
    () => relay.close(),
  );
  return { node, listener, cache, ...(mdns !== undefined ? { mdns } : {}), sent };
}

function nextMessage(link: IDeviceMeshLink): Promise<string> {
  return new Promise((resolve) => {
    const off = link.onMessage((body) => {
      off();
      resolve(body);
    });
  });
}

/** Whether `listener` says it holds `topic`. */
async function holds(listener: IMeshLanListener, topic: string): Promise<boolean> {
  const socket = new WebSocket(`ws://${LOCAL}:${listener.port}`);
  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const nonce = 'N'.repeat(22);
    socket.send(JSON.stringify({ type: 'probe', to: lanAddressOf(topic), nonce }));
    const answer = await new Promise<string>((resolve) =>
      socket.once('message', (raw) => resolve(String(raw))),
    );
    const frame = JSON.parse(answer) as { type: string; proof?: string };
    return frame.type === 'present' && verifyLanPresenceProof(topic, nonce, frame.proof);
  } finally {
    socket.close();
  }
}

/** A local port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, LOCAL, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('DiscoveringMeshRelay — the device mesh without a relay', () => {
  it('two devices find each other with mDNS, connect directly, and remember the address that worked', async () => {
    const bus = createInMemoryMdnsBus();
    const low = await lanDevice(world.low, { bus });
    const high = await lanDevice(world.high, { bus });
    await Promise.all([low.node.start(), high.node.start()]);

    const [atLow, atHigh] = await Promise.all([
      low.node.connect(world.high.cert.deviceId),
      high.node.connect(world.low.cert.deviceId),
    ]);
    expect(atLow.admission.deviceId).toBe(world.high.cert.deviceId);
    const received = nextMessage(atHigh);
    atLow.send('over the local network');
    await expect(received).resolves.toBe('over the local network');

    expect(low.cache.recall(world.high.cert.deviceId)).toEqual([
      { host: LOCAL, port: high.listener.port },
    ]);
    expect(high.cache.recall(world.low.cert.deviceId)).toEqual([
      { host: LOCAL, port: low.listener.port },
    ]);

    // What crossed the local network names no device and none of the relay's inbox topics.
    const routes = [await routeOf(world.low, world.high), await routeOf(world.high, world.low)];
    const wire = [...low.sent, ...high.sent].join('\n');
    expect(low.sent.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(wire).not.toContain(route.inbound);
      expect(wire).not.toContain(route.outbound);
    }
    for (const device of [world.low, world.high]) expect(wire).not.toContain(device.cert.deviceId);
  }, 40_000);

  it('tries the address cache first, past a stale entry, before any other source', async () => {
    const asked: string[] = [];
    const spy: IMeshCandidateSource = {
      candidates: (peer) => {
        asked.push(peer.deviceId);
        return Promise.resolve([]);
      },
    };
    const lowCache = createInMemoryMeshAddressCache();
    const highCache = createInMemoryMeshAddressCache();
    const low = await lanDevice(world.low, { cache: lowCache, extraSources: [spy] });
    const high = await lanDevice(world.high, { cache: highCache });
    // Most recent first: the stale address is tried first and fails.
    lowCache.remember(world.high.cert.deviceId, { host: LOCAL, port: high.listener.port });
    lowCache.remember(world.high.cert.deviceId, { host: LOCAL, port: await closedPort() });
    highCache.remember(world.low.cert.deviceId, { host: LOCAL, port: low.listener.port });
    // The peer is up before this device looks for it.
    await high.node.start();
    const toLow = await routeOf(world.low, world.high);
    const lanTopic = Buffer.from(
      await toLow.rendezvous.tag('lan-inbox', 'outbound', rendezvousEpoch(Date.now())),
    ).toString('base64url');
    await expect.poll(() => holds(high.listener, lanTopic)).toBe(true);
    await low.node.start();

    await Promise.all([
      low.node.connect(world.high.cert.deviceId),
      high.node.connect(world.low.cert.deviceId),
    ]);
    // Only for the third rostered device, which the cache knows nothing about.
    expect(asked).not.toContain(world.high.cert.deviceId);
    expect(asked).toContain(world.third.cert.deviceId);
    expect(lowCache.recall(world.high.cert.deviceId)[0]).toEqual({
      host: LOCAL,
      port: high.listener.port,
    });
  }, 40_000);

  it('falls back to the relay when no candidate answers, and remembers no address for it', async () => {
    const hub = createInMemoryMeshRelayHub();
    const low = await lanDevice(world.low, { relay: hub.connect() });
    const high = await lanDevice(world.high, { relay: hub.connect() });
    await Promise.all([low.node.start(), high.node.start()]);

    await Promise.all([
      low.node.connect(world.high.cert.deviceId),
      high.node.connect(world.low.cert.deviceId),
    ]);
    expect(low.cache.recall(world.high.cert.deviceId)).toEqual([]);
    expect(low.sent).toEqual([]);
  }, 40_000);

  it('a revoked peer is no longer announced to, and its address is forgotten', async () => {
    const bus = createInMemoryMdnsBus();
    const low = await lanDevice(world.low, { bus });
    await low.node.start();
    low.cache.remember(world.high.cert.deviceId, { host: LOCAL, port: 1 });
    const toHigh = await routeOf(world.low, world.high);
    const tag = Buffer.from(
      (await toHigh.rendezvous.tag('mdns', 'outbound', rendezvousEpoch(NOW))).subarray(0, 16),
    ).toString('hex');
    await expect.poll(() => JSON.stringify(bus.responses.at(-1))).toContain(tag);

    await low.node.refresh({
      identity: world.identity(world.low, { revocation: await world.revoking(world.high) }),
    });

    await expect.poll(() => low.cache.recall(world.high.cert.deviceId)).toEqual([]);
    await expect.poll(() => JSON.stringify(bus.responses.at(-1))).not.toContain(tag);
  }, 20_000);
});

describe('discovery grants nothing', () => {
  it('a candidate that leads to a device off the lists is refused, and not remembered', async () => {
    // The strongest discovery attacker: it knows the pair's local-network topics, holds them on its
    // own endpoint, and gets that endpoint offered as the peer's address.
    const toHighTopics = await routeOf(world.high, world.low);
    const epoch = rendezvousEpoch(NOW);
    const lanTopic = async (route: IMeshPeerRoute, direction: 'outbound' | 'inbound') =>
      Buffer.from(await route.rendezvous.tag('lan-inbox', direction, epoch)).toString('base64url');
    const attackerListener = await startMeshLanListener({ host: LOCAL });
    cleanups.push(() => attackerListener.close());
    attackerListener.setPresence([await lanTopic(toHighTopics, 'inbound')]);

    const planted: IMeshCandidateSource = {
      candidates: () => Promise.resolve([{ host: LOCAL, port: attackerListener.port }]),
    };
    const low = await lanDevice(world.low, { extraSources: [planted] });
    const refusals: TMeshLinkEnd[] = [];
    const admitted: IDeviceMeshLink[] = [];
    low.node.onRefusal((refusal) => refusals.push(refusal.end));
    low.node.onLink((link) => admitted.push(link));

    // The attacker answers as the peer, with a device of another roster.
    const toLow = new WebSocket(`ws://${LOCAL}:${low.listener.port}`);
    await new Promise((resolve) => toLow.once('open', resolve));
    cleanups.push(() => toLow.close());
    const outTopic = await lanTopic(toHighTopics, 'outbound');
    const instance = 'DDDDDDDDDDDDDDDDDDDDDD';
    const impostor = stranger.high;
    let rogue: MeshPeerLink | undefined;
    attackerListener.onMessage((_topic, data) => {
      const signal = data as { kind: string; from: string; cid: string; sdp?: string };
      const send = (s: object): void => {
        toLow.send(
          JSON.stringify({
            type: 'message',
            to: lanAddressOf(outTopic),
            data: { v: 1, from: instance, to: signal.from, cid: signal.cid, ...s },
          }),
        );
      };
      if (signal.kind === 'hello') {
        toLow.send(
          JSON.stringify({
            type: 'message',
            to: lanAddressOf(outTopic),
            data: { v: 1, kind: 'hello', from: instance },
          }),
        );
      } else if (signal.kind === 'offer') {
        rogue = new MeshPeerLink({
          role: 'answerer',
          createPeer: () => new RtcPeer(),
          sendSignal: send,
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
          connectTimeoutMs: 10_000,
          onAdmitted: () => undefined,
          onEnded: () => undefined,
        });
        cleanups.push(() => rogue?.close());
        rogue.onSignal({ kind: 'offer', sdp: signal.sdp! });
      } else if (signal.kind === 'ice') {
        rogue?.onSignal({ kind: 'ice', candidate: (data as { candidate: never }).candidate });
      }
    });

    await low.node.start();
    const attempt = low.node.connect(world.high.cert.deviceId, 12_000).then(
      () => 'admitted',
      () => 'refused',
    );

    await expect.poll(() => refusals.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // The impostor got as far as the handshake over a real channel, and no further.
    expect(rogue).toBeDefined();
    await expect(attempt).resolves.toBe('refused');
    expect(admitted).toEqual([]);
    // The attacker's endpoint carried the signals, and is still not remembered as the peer's.
    expect(low.cache.recall(world.high.cert.deviceId)).toEqual([]);
  }, 40_000);
});

describe('a hostile endpoint cannot hold a pair off the relay', () => {
  it('an endpoint that echoes every probe is never used', async () => {
    const { WebSocketServer } = await import('ws');
    const echo = new WebSocketServer({ host: LOCAL, port: 0 });
    await new Promise((resolve) => echo.once('listening', resolve));
    cleanups.push(() => new Promise((resolve) => echo.close(resolve)));
    let probed = 0;
    echo.on('connection', (socket) =>
      socket.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { to: string; nonce: string };
        probed += 1;
        socket.send(
          JSON.stringify({ type: 'present', to: frame.to, nonce: frame.nonce, proof: 'x' }),
        );
      }),
    );
    const address = echo.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const planted: IMeshCandidateSource = {
      candidates: () => Promise.resolve([{ host: LOCAL, port }]),
    };
    const hub = createInMemoryMeshRelayHub();
    const low = await lanDevice(world.low, { relay: hub.connect(), extraSources: [planted] });
    const high = await lanDevice(world.high, { relay: hub.connect(), extraSources: [planted] });
    await Promise.all([low.node.start(), high.node.start()]);

    await Promise.all([
      low.node.connect(world.high.cert.deviceId),
      high.node.connect(world.low.cert.deviceId),
    ]);
    expect(probed).toBeGreaterThan(0);
    // It got probes, never a signal.
    expect(low.sent.filter((frame) => frame.includes('"message"'))).toEqual([]);
    expect(low.cache.recall(world.high.cert.deviceId)).toEqual([]);
  }, 40_000);

  it('an endpoint that holds the topic but leads to no admission is set aside for the relay', async () => {
    // It knows the pair's topic and swallows everything sent to it.
    const epoch = rendezvousEpoch(NOW);
    const toHigh = await routeOf(world.low, world.high);
    const sink = await startMeshLanListener({ host: LOCAL });
    cleanups.push(() => sink.close());
    let swallowed = 0;
    sink.onMessage(() => (swallowed += 1));
    sink.setPresence([
      Buffer.from(await toHigh.rendezvous.tag('lan-inbox', 'outbound', epoch)).toString(
        'base64url',
      ),
    ]);
    const planted: IMeshCandidateSource = {
      candidates: () => Promise.resolve([{ host: LOCAL, port: sink.port }]),
    };
    const hub = createInMemoryMeshRelayHub();
    const low = await lanDevice(world.low, {
      relay: hub.connect(),
      extraSources: [planted],
      admissionTimeoutMs: 1_000,
      connectTimeoutMs: 4_000,
    });
    const high = await lanDevice(world.high, { relay: hub.connect() });
    await Promise.all([low.node.start(), high.node.start()]);

    // The first attempt's signals are swallowed.
    await expect(low.node.connect(world.high.cert.deviceId, 2_000)).rejects.toThrow();
    expect(swallowed).toBeGreaterThan(0);
    // Once set aside, the relay carries the pair, and the sink is not remembered.
    await expect
      .poll(
        async () => {
          const [a] = await Promise.allSettled([
            low.node.connect(world.high.cert.deviceId, 3_000),
            high.node.connect(world.low.cert.deviceId, 3_000),
          ]);
          return a.status;
        },
        { timeout: 20_000, interval: 200 },
      )
      .toBe('fulfilled');
    expect(low.cache.recall(world.high.cert.deviceId)).toEqual([]);
  }, 40_000);
});

describe('a proxy that forwards once', () => {
  it('cannot hold the pair off the relay by swallowing a later attempt', async () => {
    const hub = createInMemoryMeshRelayHub();
    const high = await lanDevice(world.high, { relay: hub.connect() });
    // A transparent proxy to the peer's real endpoint, which later starts swallowing what it gets.
    const { WebSocketServer } = await import('ws');
    const proxy = new WebSocketServer({ host: LOCAL, port: 0 });
    await new Promise((resolve) => proxy.once('listening', resolve));
    cleanups.push(() => new Promise((resolve) => proxy.close(resolve)));
    let swallowing = false;
    let swallowed = 0;
    proxy.on('connection', (client) => {
      const upstream = new WebSocket(`ws://${LOCAL}:${high.listener.port}`);
      const early: string[] = [];
      upstream.on('open', () => early.splice(0).forEach((frame) => upstream.send(frame)));
      upstream.on('message', (raw) => client.send(String(raw)));
      client.on('message', (raw) => {
        const frame = String(raw);
        if (swallowing && frame.includes('"message"')) {
          swallowed += 1;
          return;
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
        else early.push(frame);
      });
      client.on('close', () => upstream.close());
    });
    const address = proxy.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const planted: IMeshCandidateSource = {
      candidates: () => Promise.resolve([{ host: LOCAL, port }]),
    };
    const low = await lanDevice(world.low, {
      relay: hub.connect(),
      extraSources: [planted],
      admissionTimeoutMs: 1_000,
    });
    await Promise.all([low.node.start(), high.node.start()]);

    // The first connection goes through the proxy and is admitted.
    const first = await low.node.connect(world.high.cert.deviceId);
    expect(low.cache.recall(world.high.cert.deviceId)).toEqual([{ host: LOCAL, port }]);

    // Now it swallows, and the connection ends: the next attempt's signals go nowhere through it.
    swallowing = true;
    first.close();
    await expect
      .poll(
        async () => {
          const [a] = await Promise.allSettled([
            low.node.connect(world.high.cert.deviceId, 3_000),
            high.node.connect(world.low.cert.deviceId, 3_000),
          ]);
          return a.status;
        },
        { timeout: 25_000, interval: 200 },
      )
      .toBe('fulfilled');
    expect(swallowed).toBeGreaterThan(0);
    expect(low.node.link(world.high.cert.deviceId)).not.toBe(first);
  }, 40_000);
});

describe('the direct signaling endpoint', () => {
  it('delivers only to the topics it holds, and closes a connection that floods it', async () => {
    const listener = await startMeshLanListener({ host: LOCAL });
    cleanups.push(() => listener.close());
    const held = 'H'.repeat(43);
    const other = 'O'.repeat(43);
    listener.setPresence([held]);
    const delivered: unknown[] = [];
    listener.onMessage((topic, data) => delivered.push([topic, data]));

    const socket = new WebSocket(`ws://${LOCAL}:${listener.port}`);
    cleanups.push(() => socket.close());
    const answers: string[] = [];
    socket.on('message', (raw) => answers.push(String(raw)));
    await new Promise((resolve) => socket.once('open', resolve));
    // Frames are addressed by the topic's hash: the topic itself never crosses the network.
    socket.send(JSON.stringify({ type: 'message', to: lanAddressOf(held), data: { n: 1 } }));
    socket.send(JSON.stringify({ type: 'message', to: held, data: { n: 0 } }));
    socket.send(JSON.stringify({ type: 'message', to: lanAddressOf(other), data: { n: 2 } }));
    socket.send('not json');
    socket.send(JSON.stringify({ type: 'message', to: '__proto__', data: { n: 3 } }));
    await expect
      .poll(() => answers)
      .toEqual([
        JSON.stringify({ type: 'absent', to: held }),
        JSON.stringify({ type: 'absent', to: lanAddressOf(other) }),
      ]);
    expect(delivered).toEqual([[held, { n: 1 }]]);

    let closed = false;
    socket.on('close', () => (closed = true));
    for (let i = 0; i < 200; i += 1) {
      socket.send(JSON.stringify({ type: 'probe', to: lanAddressOf(held), nonce: 'N'.repeat(22) }));
    }
    await expect.poll(() => closed).toBe(true);
  });
});
