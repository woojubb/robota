/**
 * The device mesh through a TURN relay, on a network where no direct path works: every candidate
 * but a relayed one is dropped on the way (a symmetric NAT on both sides), and the connections are
 * told to use relay candidates only.
 */
import {
  derivePairRendezvous,
  extractDtlsFingerprint,
  startDeviceHandshake,
} from '@robota-sdk/agent-remote-pairing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  loadDataChannel,
  type IDataChannelModule,
  type INdcPeerConnection,
} from '../datachannel-loader.js';
import {
  DeviceMeshNode,
  type IDeviceMeshLink,
  type IDeviceMeshNodeOptions,
} from '../device-mesh-node.js';
import { MeshPeerLink } from '../mesh-peer-link.js';
import {
  createInMemoryMeshRelayHub,
  type IInMemoryMeshRelayHub,
  type IMeshRelay,
} from '../mesh-relay.js';
import {
  MeshRelayNeededError,
  MeshTurnRelay,
  meshRelayIceServers,
  type IMeshRelayEndpoint,
} from '../mesh-turn-relay.js';
import { RtcPeer } from '../rtc-peer.js';
import { TurnServer } from '../turn-server.js';
import {
  ALL_CAPABILITIES,
  buildMeshWorld,
  type IMeshTestDevice,
  type IMeshTestWorld,
} from './mesh-fixtures.js';

let world: IMeshTestWorld;
const nodes: DeviceMeshNode[] = [];
const cleanups: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  world = await buildMeshWorld();
});

afterEach(async () => {
  for (const node of nodes.splice(0)) node.stop();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** Every candidate crossing the signaling path, and whether it was relayed. */
interface INatLog {
  readonly candidates: string[];
}

/** A relay client behind a symmetric NAT: only relayed candidates ever reach the peer. */
function behindSymmetricNat(relay: IMeshRelay, log: INatLog): IMeshRelay {
  return {
    ...relay,
    declarePresence: (topics) => relay.declarePresence(topics),
    onMessage: (handler) => relay.onMessage(handler),
    onAbsent: (handler) => relay.onAbsent(handler),
    close: () => relay.close(),
    send: (topic, data) => {
      const signal = data as { kind?: string; sdp?: string; candidate?: { candidate: string } };
      if (signal.kind === 'ice') {
        const candidate = signal.candidate?.candidate ?? '';
        log.candidates.push(candidate);
        if (!/ typ relay/.test(candidate)) return;
      }
      if ((signal.kind === 'offer' || signal.kind === 'answer') && signal.sdp !== undefined) {
        const sdp = signal.sdp
          .split('\r\n')
          .filter((line) => !line.startsWith('a=candidate') || / typ relay/.test(line))
          .join('\r\n');
        relay.send(topic, { ...signal, sdp });
        return;
      }
      relay.send(topic, data);
    },
  };
}

/** The WebRTC module, recording each connection's own fingerprint and the one its DTLS verified. */
function recordingDataChannel(): {
  readonly load: () => IDataChannelModule;
  readonly local: Set<string>;
  readonly verified: Set<string>;
} {
  const real = loadDataChannel();
  const local = new Set<string>();
  const verified = new Set<string>();
  const Recorded = function (
    name: string,
    config: ConstructorParameters<IDataChannelModule['PeerConnection']>[1],
  ) {
    const pc = new real.PeerConnection(name, config);
    // Native methods are read-only and need their own receiver: delegate rather than patch.
    const recorded: INdcPeerConnection = {
      close: () => pc.close(),
      setLocalDescription: (type) => pc.setLocalDescription(type),
      setRemoteDescription: (sdp, type) => pc.setRemoteDescription(sdp, type),
      localDescription: () => pc.localDescription(),
      remoteFingerprint: () => {
        const fingerprint = pc.remoteFingerprint();
        if (fingerprint.value.length > 0) verified.add(fingerprint.value.toLowerCase());
        return fingerprint;
      },
      addRemoteCandidate: (candidate, mid) => pc.addRemoteCandidate(candidate, mid),
      createDataChannel: (label) => pc.createDataChannel(label),
      state: () => pc.state(),
      onLocalDescription: (callback) =>
        pc.onLocalDescription((sdp, type) => {
          local.add(extractDtlsFingerprint(sdp).toLowerCase());
          callback(sdp, type);
        }),
      onLocalCandidate: (callback) => pc.onLocalCandidate(callback),
      onStateChange: (callback) => pc.onStateChange(callback),
      onDataChannel: (callback) => pc.onDataChannel(callback),
    };
    return recorded;
  } as unknown as IDataChannelModule['PeerConnection'];
  return { load: () => ({ PeerConnection: Recorded }), local, verified };
}

async function pairOf(own: IMeshTestDevice, peer: IMeshTestDevice) {
  return derivePairRendezvous({
    ownKaPrivateKey: own.ka.privateKey,
    own: own.cert,
    peerDeviceId: peer.cert.deviceId,
    lists: world.identity(own),
  });
}

/** The embedded relay on `host`, serving the other two devices. */
async function embeddedRelay(host: IMeshTestDevice): Promise<MeshTurnRelay> {
  const relay = await MeshTurnRelay.start({ host: '127.0.0.1', port: 0 });
  cleanups.push(() => relay.close());
  const others = [world.low, world.high, world.third].filter((d) => d !== host);
  relay.declarePeers(
    await Promise.all(
      others.map(async (d) => ({ deviceId: d.cert.deviceId, rendezvous: await pairOf(host, d) })),
    ),
  );
  return relay;
}

function advertising(
  device: IMeshTestDevice,
  endpoint: IMeshRelayEndpoint,
): (
  peers: readonly unknown[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<string, readonly IMeshRelayEndpoint[]>> {
  return () => Promise.resolve(new Map([[device.cert.deviceId, [endpoint]]]));
}

function node(
  hub: IInMemoryMeshRelayHub,
  device: IMeshTestDevice,
  log: INatLog,
  over: Partial<IDeviceMeshNodeOptions> = {},
): DeviceMeshNode {
  const created = new DeviceMeshNode({
    identity: world.identity(device),
    sessionDescriptor: device.session,
    localPolicy: ALL_CAPABILITIES,
    relay: behindSymmetricNat(hub.connect(), log),
    connectTimeoutMs: 15_000,
    ...over,
  });
  nodes.push(created);
  return created;
}

function nextMessage(link: IDeviceMeshLink): Promise<string> {
  return new Promise((resolve) => {
    const off = link.onMessage((body) => {
      off();
      resolve(body);
    });
  });
}

describe('DeviceMeshNode — through the embedded TURN relay behind symmetric NATs', () => {
  it('two devices connect only through the relay a third device runs; DTLS stays end to end', async () => {
    const hub = createInMemoryMeshRelayHub();
    const relay = await embeddedRelay(world.third);
    const log: INatLog = { candidates: [] };
    const atLowPc = recordingDataChannel();
    const atHighPc = recordingDataChannel();
    const relays = { advertised: advertising(world.third, relay.endpoint), relayOnly: true };
    const low = node(hub, world.low, log, { relays, loadDataChannel: atLowPc.load });
    const high = node(hub, world.high, log, { relays, loadDataChannel: atHighPc.load });
    await Promise.all([low.start(), high.start()]);

    const [atLow, atHigh] = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);

    expect(atLow.admission.deviceId).toBe(world.high.cert.deviceId);
    expect(atHigh.admission.deviceId).toBe(world.low.cert.deviceId);
    const toHigh = nextMessage(atHigh);
    atLow.send('relayed hello');
    await expect(toHigh).resolves.toBe('relayed hello');

    // The only way across was the relay, and each device held an allocation on it.
    expect(log.candidates.length).toBeGreaterThan(0);
    expect(log.candidates.every((c) => / typ relay /.test(c))).toBe(true);
    expect(relay.allocationCount(world.low.cert.deviceId)).toBeGreaterThan(0);
    expect(relay.allocationCount(world.high.cert.deviceId)).toBeGreaterThan(0);
    // Channel binding: the certificate each side's DTLS verified is the one the other side made,
    // so the relay terminated nothing.
    expect(atLowPc.verified.size).toBeGreaterThan(0);
    for (const fingerprint of atLowPc.verified) expect(atHighPc.local).toContain(fingerprint);
    for (const fingerprint of atHighPc.verified) expect(atLowPc.local).toContain(fingerprint);
  }, 40_000);

  it("through the relay, another rostered device reaching the pair's inbox is still refused by the handshake", async () => {
    const hub = createInMemoryMeshRelayHub();
    // low runs the relay; high and the impostor (third) are both its peers.
    const relay = await embeddedRelay(world.low);
    const log: INatLog = { candidates: [] };
    const high = node(hub, world.high, log, {
      relays: { advertised: advertising(world.low, relay.endpoint), relayOnly: true },
    });
    const refusals: string[] = [];
    high.onRefusal((refusal) => refusals.push(refusal.end));
    const linked: IDeviceMeshLink[] = [];
    high.onLink((link) => linked.push(link));
    await high.start();

    const topics = await (await pairOf(world.low, world.high)).relayInbox();
    const iceServers = await meshRelayIceServers(
      await pairOf(world.third, world.low),
      [relay.endpoint],
      Date.now(),
    );
    const impostorRelay = behindSymmetricNat(hub.connect(), log);
    impostorRelay.declarePresence([topics.inbound]);
    const instance = 'DDDDDDDDDDDDDDDDDDDDDD';
    const cid = 'EEEEEEEEEEEEEEEEEEEEEE';
    let impostorAdmitted = false;
    const impostor = new MeshPeerLink({
      role: 'offerer',
      createPeer: () => new RtcPeer({ iceServers, forceTurn: true }),
      sendSignal: (signal) =>
        impostorRelay.send(topics.outbound, {
          v: 1,
          from: instance,
          to: high.instance,
          cid,
          ...signal,
        }),
      startHandshake: (binding) =>
        startDeviceHandshake({
          role: 'initiator',
          identity: world.identity(world.third),
          sessionDescriptor: world.third.session,
          expectedPeerDeviceId: world.high.cert.deviceId,
          localFingerprint: binding.localFingerprint,
          remoteFingerprint: binding.remoteFingerprint,
          locality: 'another-host',
          localPolicy: ALL_CAPABILITIES,
          send: binding.send,
        }),
      connectTimeoutMs: 10_000,
      onAdmitted: () => (impostorAdmitted = true),
      onEnded: () => undefined,
    });
    impostorRelay.onMessage((_topic, data) => {
      const signal = data as { kind: string; sdp?: string; candidate?: never };
      if (signal.kind === 'answer') impostor.onSignal({ kind: 'answer', sdp: signal.sdp! });
      else if (signal.kind === 'ice')
        impostor.onSignal({ kind: 'ice', candidate: signal.candidate! });
    });
    await impostor.offer();

    // The relay carried the connection far enough for the handshake to refuse it.
    await expect.poll(() => refusals, { timeout: 15_000 }).toEqual(['handshake']);
    expect(relay.allocationCount(world.third.cert.deviceId)).toBeGreaterThan(0);
    await expect.poll(() => impostor.ended, { timeout: 5_000 }).toBe(true);
    expect(impostorAdmitted).toBe(false);
    expect(linked).toEqual([]);
  }, 30_000);
});

describe('DeviceMeshNode — relay fallback order', () => {
  async function configuredTurn(): Promise<{ server: TurnServer; urls: string }> {
    const server = await TurnServer.start({
      host: '127.0.0.1',
      port: 0,
      authorize: (username) =>
        Promise.resolve(username === 'mine' ? { owner: 'me', password: 'secret' } : undefined),
    });
    cleanups.push(() => server.close());
    return { server, urls: `turn:127.0.0.1:${server.address.port}` };
  }

  it('the embedded relay comes first: a configured TURN server is not contacted while it works', async () => {
    const hub = createInMemoryMeshRelayHub();
    const relay = await embeddedRelay(world.third);
    const configured = await configuredTurn();
    const relays = {
      advertised: advertising(world.third, relay.endpoint),
      configured: [{ urls: configured.urls, username: 'mine', credential: 'secret' }],
      relayOnly: true,
    };
    const log: INatLog = { candidates: [] };
    const low = node(hub, world.low, log, { relays });
    const high = node(hub, world.high, log, { relays });
    await Promise.all([low.start(), high.start()]);

    await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);

    expect(relay.allocationCount()).toBeGreaterThan(0);
    expect(configured.server.allocationCount()).toBe(0);
  }, 40_000);

  it('when the embedded relay does not carry a connection, the next attempt uses the configured TURN server', async () => {
    const hub = createInMemoryMeshRelayHub();
    // An advertised relay that is gone.
    const gone = await MeshTurnRelay.start({ host: '127.0.0.1', port: 0 });
    const endpoint = gone.endpoint;
    await gone.close();
    const configured = await configuredTurn();
    const relays = {
      advertised: advertising(world.third, endpoint),
      configured: [{ urls: configured.urls, username: 'mine', credential: 'secret' }],
      relayOnly: true,
    };
    const log: INatLog = { candidates: [] };
    const low = node(hub, world.low, log, { relays, connectTimeoutMs: 4_000 });
    const high = node(hub, world.high, log, { relays, connectTimeoutMs: 4_000 });
    await Promise.all([low.start(), high.start()]);

    const first = await Promise.allSettled([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);
    expect(first.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(configured.server.allocationCount()).toBe(0);

    const [atLow] = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);
    expect(atLow.admission.deviceId).toBe(world.high.cert.deviceId);
    expect(configured.server.allocationCount()).toBeGreaterThan(0);
  }, 40_000);

  it('with no relay advertised or configured and relay candidates required, the connection fails closed at once', async () => {
    const hub = createInMemoryMeshRelayHub();
    const log: INatLog = { candidates: [] };
    const low = node(hub, world.low, log, { relays: { relayOnly: true } });
    const high = node(hub, world.high, log, { relays: { relayOnly: true } });
    await Promise.all([low.start(), high.start()]);

    const result = low.connect(world.high.cert.deviceId);
    void high.connect(world.low.cert.deviceId).catch(() => undefined);

    await expect(result).rejects.toBeInstanceOf(MeshRelayNeededError);
    await expect(result).rejects.toThrow(/a relay device is needed/);
  }, 20_000);

  it('with no relay at all, a direct attempt the network defeats ends in the explicit relay error, not a silent failure', async () => {
    const hub = createInMemoryMeshRelayHub();
    const log: INatLog = { candidates: [] };
    const low = node(hub, world.low, log, { connectTimeoutMs: 4_000 });
    const high = node(hub, world.high, log, { connectTimeoutMs: 4_000 });
    await Promise.all([low.start(), high.start()]);

    const [atLow, atHigh] = await Promise.allSettled([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);

    expect(atLow.status === 'rejected' && atLow.reason).toBeInstanceOf(MeshRelayNeededError);
    expect(atHigh.status === 'rejected' && atHigh.reason).toBeInstanceOf(MeshRelayNeededError);
    // Candidates were gathered, and none could cross.
    expect(log.candidates.length).toBeGreaterThan(0);
  }, 20_000);
});
