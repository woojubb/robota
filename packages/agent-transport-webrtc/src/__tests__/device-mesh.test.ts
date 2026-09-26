import {
  DeviceHandshakeError,
  derivePairRendezvous,
  startDeviceHandshake,
  type IListUpdate,
} from '@robota-sdk/agent-remote-pairing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  DeviceMeshNode,
  type IDeviceMeshLink,
  type IDeviceMeshNodeOptions,
} from '../device-mesh-node.js';
import { MeshLinkEndedError, MeshPeerLink, type TMeshLinkEnd } from '../mesh-peer-link.js';
import { createInMemoryMeshRelayHub, type IInMemoryMeshRelayHub } from '../mesh-relay.js';
import {
  ALL_CAPABILITIES,
  buildMeshWorld,
  type IMeshTestDevice,
  type IMeshTestWorld,
} from './mesh-fixtures.js';

import { loadDataChannel, type IDataChannelModule } from '../datachannel-loader.js';
import { RtcPeer } from '../rtc-peer.js';

let world: IMeshTestWorld;
const nodes: DeviceMeshNode[] = [];

beforeAll(async () => {
  world = await buildMeshWorld();
});

afterEach(() => {
  for (const node of nodes.splice(0)) node.stop();
});

/** The WebRTC module, counting the peer connections a node creates. */
function countingDataChannel(): { load: () => IDataChannelModule; created: () => number } {
  let count = 0;
  const real = loadDataChannel();
  const Counted = function (
    name: string,
    config: ConstructorParameters<IDataChannelModule['PeerConnection']>[1],
  ) {
    count += 1;
    return new real.PeerConnection(name, config);
  } as unknown as IDataChannelModule['PeerConnection'];
  return { load: () => ({ PeerConnection: Counted }), created: () => count };
}

/** An offer SDP from a real connection, with its connection for closing. */
async function realOffer(): Promise<{ sdp: string; close: () => void }> {
  const peer = new RtcPeer();
  peer.createDataChannel('robota-mesh');
  const sdp = await peer.createOffer();
  return { sdp, close: () => peer.close() };
}

function node(
  hub: IInMemoryMeshRelayHub,
  device: IMeshTestDevice,
  over: Partial<IDeviceMeshNodeOptions> = {},
): DeviceMeshNode {
  const created = new DeviceMeshNode({
    identity: world.identity(device),
    sessionDescriptor: device.session,
    localPolicy: ALL_CAPABILITIES,
    relay: hub.connect(),
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

describe('DeviceMeshNode — CLI↔CLI connection over WebRTC', () => {
  it('two devices connect through the relay, admit each other by the device handshake, and exchange messages', async () => {
    const hub = createInMemoryMeshRelayHub();
    const low = node(hub, world.low);
    const high = node(hub, world.high);
    await Promise.all([low.start(), high.start()]);

    const [atLow, atHigh] = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);

    expect(atLow.admission.deviceId).toBe(world.high.cert.deviceId);
    expect(atHigh.admission.deviceId).toBe(world.low.cert.deviceId);
    expect(atLow.admission.trust).toBe('same-user-different-host');
    expect(atLow.admission.locality).toBe('another-host');
    // Each end names the same connection: its own fingerprint is the one the other end verified.
    expect(atLow.channelBinding.localFingerprint).toBe(atHigh.channelBinding.remoteFingerprint);
    expect(atHigh.channelBinding.localFingerprint).toBe(atLow.channelBinding.remoteFingerprint);
    expect(atLow.channelBinding.localFingerprint).not.toBe(atLow.channelBinding.remoteFingerprint);

    const toHigh = nextMessage(atHigh);
    atLow.send('hello from low');
    await expect(toHigh).resolves.toBe('hello from low');
    const toLow = nextMessage(atLow);
    atHigh.send('hello from high');
    await expect(toLow).resolves.toBe('hello from high');
  }, 40_000);

  it('a peer this connection does not allow to message is not heard, and the connection ends', async () => {
    const hub = createInMemoryMeshRelayHub();
    // This device's policy grants the peer presence only.
    const low = node(hub, world.low, { localPolicy: ['presence'] });
    const high = node(hub, world.high);
    await Promise.all([low.start(), high.start()]);
    const [atLow, atHigh] = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);
    expect(atLow.admission.capabilities).toEqual(['presence']);
    await expect(atLow.authority.authorize('message')).resolves.toEqual({
      allowed: false,
      reason: 'not-granted',
    });
    const heard: string[] = [];
    let closed = false;
    atLow.onMessage((body) => heard.push(body));
    atLow.onClose(() => (closed = true));

    atHigh.send('should not be heard');

    await expect.poll(() => closed).toBe(true);
    expect(heard).toEqual([]);
  }, 40_000);

  it('glare: both devices reaching for each other at once make exactly one connection, offered by the lower id', async () => {
    const hub = createInMemoryMeshRelayHub();
    const lowRtc = countingDataChannel();
    const highRtc = countingDataChannel();
    const low = node(hub, world.low, { loadDataChannel: lowRtc.load });
    const high = node(hub, world.high, { loadDataChannel: highRtc.load });
    expect(low.roleFor(world.high.cert.deviceId)).toBeUndefined();

    // Both start (each announcing itself) and both ask for the connection concurrently.
    await Promise.all([low.start(), high.start()]);
    const links = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);
    // Let any late hello settle; a second connection would be created by now.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(low.roleFor(world.high.cert.deviceId)).toBe('offerer');
    expect(high.roleFor(world.low.cert.deviceId)).toBe('answerer');
    expect(lowRtc.created()).toBe(1);
    expect(highRtc.created()).toBe(1);
    expect(links[0]).toBe(links[2]);
    expect(links[1]).toBe(links[3]);
  }, 40_000);

  it("glare: an offer toward the pair's offerer is never taken", async () => {
    const hub = createInMemoryMeshRelayHub();
    const lowRtc = countingDataChannel();
    const low = node(hub, world.low, { loadDataChannel: lowRtc.load });
    const high = node(hub, world.high);
    await Promise.all([low.start(), high.start()]);
    const established = await low.connect(world.high.cert.deviceId);
    let closed = false;
    established.onClose(() => (closed = true));

    // The higher-id side of the pair (anyone who can reach the pair's inbox) sends an offer to the
    // lower-id device, as if the higher one had decided to open the connection itself.
    const topics = await (
      await derivePairRendezvous({
        ownKaPrivateKey: world.high.ka.privateKey,
        own: world.high.cert,
        peerDeviceId: world.low.cert.deviceId,
        lists: world.identity(world.high),
      })
    ).relayInbox();
    const rogue = hub.connect();
    const offerer = await realOffer();
    rogue.send(topics.outbound, {
      v: 1,
      kind: 'offer',
      from: 'AAAAAAAAAAAAAAAAAAAAAA',
      to: low.instance,
      cid: 'BBBBBBBBBBBBBBBBBBBBBB',
      sdp: offerer.sdp,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // No second connection, and the pair's one connection is untouched.
    expect(lowRtc.created()).toBe(1);
    expect(closed).toBe(false);
    expect(low.link(world.high.cert.deviceId)).toBe(established);
    offerer.close();
  }, 20_000);

  it('a revoked device is refused: the freshness lookup brings a revocation and the handshake refuses it', async () => {
    const hub = createInMemoryMeshRelayHub();
    const revocation = await world.revoking(world.high);
    const refusals: unknown[] = [];
    const low = node(hub, world.low, {
      // A signing-key holder answers the freshness lookup with a list that revokes `high`.
      fetchLatestLists: () => Promise.resolve({ revocation }),
    });
    low.onRefusal((refusal) => refusals.push(refusal.error));
    const high = node(hub, world.high);
    const admitted: IDeviceMeshLink[] = [];
    low.onLink((link) => admitted.push(link));
    await Promise.all([low.start(), high.start()]);

    const [atLow, atHigh] = await Promise.allSettled([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);

    // Both sides: a link is admitted only once each side admitted the other.
    expect(atLow.status).toBe('rejected');
    expect(atHigh.status).toBe('rejected');
    expect(admitted).toHaveLength(0);
    // Refused by the handshake's chain check, or dropped as soon as the adopted list is in force.
    const error = refusals[0] as Error;
    if (error instanceof MeshLinkEndedError) {
      // The refusal says what happened: which step, which role, what the connection went through.
      expect(error.end).toBe('handshake');
      expect(error.stage).toBe('handshake');
      expect(error.role).toBe('offerer');
      expect(error.peer?.history).toContain('connected');
      expect(error.cause).toBeInstanceOf(DeviceHandshakeError);
      expect((error.cause as DeviceHandshakeError).chain?.reason).toBe('revoked');
      expect(error.message).toMatch(/during handshake as offerer.*revoked.*connection connected/);
    } else {
      expect(error.message).toMatch(/revoked/);
    }
    // The revocation is in force for the rest of the run: the device is no longer reached for.
    await expect(low.connect(world.high.cert.deviceId)).rejects.toThrow(
      /not a rostered, unrevoked/,
    );
    // Not even when the caller later hands over the older lists it still has stored.
    await low.refresh({ identity: world.identity(world.low) });
    await expect(low.connect(world.high.cert.deviceId)).rejects.toThrow(
      /not a rostered, unrevoked/,
    );
  }, 40_000);

  it('one connection per pair: a peer that restarts gets a fresh connection that replaces the old one', async () => {
    const hub = createInMemoryMeshRelayHub();
    const low = node(hub, world.low);
    const first = node(hub, world.high);
    await Promise.all([low.start(), first.start()]);
    const before = await low.connect(world.high.cert.deviceId);
    let beforeClosed = false;
    before.onClose(() => (beforeClosed = true));

    // The same device runs again (a new process) while the old connection has not been noticed as gone.
    const second = node(hub, world.high);
    await second.start();
    const atSecond = await second.connect(world.low.cert.deviceId);

    await expect
      .poll(() => {
        const current = low.link(world.high.cert.deviceId);
        return current !== undefined && current !== before;
      })
      .toBe(true);
    expect(beforeClosed).toBe(true);
    const after = low.link(world.high.cert.deviceId)!;
    const received = nextMessage(atSecond);
    after.send('to the new run');
    await expect(received).resolves.toBe('to the new run');
  }, 40_000);

  it('forged announcements neither cut an admitted connection nor open connections without bound', async () => {
    const hub = createInMemoryMeshRelayHub();
    const lowRtc = countingDataChannel();
    const low = node(hub, world.low, { loadDataChannel: lowRtc.load });
    const high = node(hub, world.high);
    await Promise.all([low.start(), high.start()]);
    const established = await low.connect(world.high.cert.deviceId);
    let closed = false;
    established.onClose(() => (closed = true));
    expect(lowRtc.created()).toBe(1);

    // Anyone who can reach the pair's inbox (the relay) announces 50 "new runs" of the peer.
    const topics = await (
      await derivePairRendezvous({
        ownKaPrivateKey: world.high.ka.privateKey,
        own: world.high.cert,
        peerDeviceId: world.low.cert.deviceId,
        lists: world.identity(world.high),
      })
    ).relayInbox();
    const forger = hub.connect();
    for (let i = 0; i < 50; i += 1) {
      forger.send(topics.outbound, {
        v: 1,
        kind: 'hello',
        from: `${String(i).padStart(2, '0')}${'F'.repeat(20)}`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(closed).toBe(false);
    expect(low.link(world.high.cert.deviceId)).toBe(established);
    // Paced: one attempt at once and at most one more per second, not one per announcement.
    expect(lowRtc.created()).toBeLessThanOrEqual(3);
    const received = nextMessage(await high.connect(world.low.cert.deviceId));
    established.send('still connected');
    await expect(received).resolves.toBe('still connected');
  }, 40_000);

  it('lists handed over later apply to the running node: a revoked peer loses its connection', async () => {
    const hub = createInMemoryMeshRelayHub();
    const low = node(hub, world.low);
    const high = node(hub, world.high);
    await Promise.all([low.start(), high.start()]);
    const established = await low.connect(world.high.cert.deviceId);
    let closed = false;
    established.onClose(() => (closed = true));

    await low.refresh({
      identity: world.identity(world.low, { revocation: await world.revoking(world.high) }),
    });

    expect(closed).toBe(true);
    expect(low.link(world.high.cert.deviceId)).toBeUndefined();
    await expect(low.connect(world.high.cert.deviceId)).rejects.toThrow(
      /not a rostered, unrevoked/,
    );
  }, 40_000);

  it('stopping rejects a pending connect at once', async () => {
    const hub = createInMemoryMeshRelayHub();
    const low = node(hub, world.low);
    await low.start();
    const pending = low.connect(world.high.cert.deviceId, 30_000);
    low.stop();
    await expect(pending).rejects.toThrow(/stopped/);
  });

  it('a device whose own list revokes the peer does not even reach for it', async () => {
    const hub = createInMemoryMeshRelayHub();
    const revocation = await world.revoking(world.high);
    const low = new DeviceMeshNode({
      identity: world.identity(world.low, { revocation }),
      sessionDescriptor: world.low.session,
      localPolicy: ALL_CAPABILITIES,
      relay: hub.connect(),
    });
    nodes.push(low);
    await low.start();
    await expect(low.connect(world.high.cert.deviceId)).rejects.toThrow(
      /not a rostered, unrevoked/,
    );
  });
});

describe('DeviceMeshNode — newer lists reach linked devices over the live connection', () => {
  it('a list one device takes up is pushed to a linked device, whatever that device lets the peer ask', async () => {
    const hub = createInMemoryMeshRelayHub();
    const adopted: IListUpdate[] = [];
    const low = node(hub, world.low);
    // Lists are not a capability: a device that grants its peer presence only still takes them.
    const high = node(hub, world.high, {
      localPolicy: ['presence'],
      onListsAdopted: (update) => adopted.push(update),
    });
    await Promise.all([low.start(), high.start()]);
    const [, atHigh] = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);
    const heard: string[] = [];
    let closed = false;
    atHigh.onMessage((body) => heard.push(body));
    atHigh.onClose(() => (closed = true));

    const revocation = await world.revoking(world.third);
    await low.refresh({ identity: world.identity(world.low, { revocation }) });

    await expect.poll(() => adopted.length).toBe(1);
    expect(adopted[0]!.revocation).toEqual(revocation);
    expect(adopted[0]!.roster).toBeUndefined();
    await expect(high.connect(world.third.cert.deviceId)).rejects.toThrow(
      /not a rostered, unrevoked/,
    );
    // The lists are the node's own business: the application hears nothing and the link stays.
    expect(heard).toEqual([]);
    expect(closed).toBe(false);
    expect(high.link(world.low.cert.deviceId)).toBe(atHigh);
  }, 40_000);

  it('a pushed list that does not verify, or is not newer, is ignored and the link stays', async () => {
    const hub = createInMemoryMeshRelayHub();
    const adopted: IListUpdate[] = [];
    const low = node(hub, world.low);
    const high = node(hub, world.high, { onListsAdopted: (update) => adopted.push(update) });
    await Promise.all([low.start(), high.start()]);
    const [atLow, atHigh] = await Promise.all([
      low.connect(world.high.cert.deviceId),
      high.connect(world.low.cert.deviceId),
    ]);
    const heard: string[] = [];
    atHigh.onMessage((body) => heard.push(body));

    const revocation = await world.revoking(world.third);
    const current = world.identity(world.high);
    for (const frame of [
      // Signed for seq 11, claiming 12.
      { t: 'mesh-lists', revocation: { ...revocation, seq: 12 } },
      // The same list the device already holds.
      { t: 'mesh-lists', roster: current.roster, revocation: current.revocation },
      { t: 'mesh-lists', revocation: 'not a list' },
    ]) {
      atLow.send(JSON.stringify(frame));
    }
    atLow.send('still here');

    await expect.poll(() => heard).toEqual(['still here']);
    expect(adopted).toEqual([]);
    expect(high.link(world.low.cert.deviceId)).toBe(atHigh);
    await expect(high.connect(world.third.cert.deviceId, 1)).rejects.toThrow(/in time/);
  }, 40_000);
});

describe('DeviceMeshNode — the peer is the device its inbox belongs to', () => {
  it("another rostered device reaching the pair's inbox is refused before it is told it was admitted", async () => {
    const hub = createInMemoryMeshRelayHub();
    const high = node(hub, world.high);
    const refusals: string[] = [];
    high.onRefusal((refusal) => refusals.push(refusal.end));
    const linked: IDeviceMeshLink[] = [];
    high.onLink((link) => linked.push(link));
    await high.start();

    // The relay moves a third device's offer into the low–high inbox and returns high's answer to it.
    const topics = await (
      await derivePairRendezvous({
        ownKaPrivateKey: world.low.ka.privateKey,
        own: world.low.cert,
        peerDeviceId: world.high.cert.deviceId,
        lists: world.identity(world.low),
      })
    ).relayInbox();
    const relay = hub.connect();
    relay.declarePresence([topics.inbound]);
    const instance = 'DDDDDDDDDDDDDDDDDDDDDD';
    const cid = 'EEEEEEEEEEEEEEEEEEEEEE';
    let thirdAdmitted = false;
    const third = new MeshPeerLink({
      role: 'offerer',
      createPeer: () => new RtcPeer(),
      sendSignal: (signal) =>
        relay.send(topics.outbound, { v: 1, from: instance, to: high.instance, cid, ...signal }),
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
      onAdmitted: () => (thirdAdmitted = true),
      onEnded: () => undefined,
    });
    relay.onMessage((_topic, data) => {
      const signal = data as { kind: string; sdp?: string; candidate?: never };
      if (signal.kind === 'answer') third.onSignal({ kind: 'answer', sdp: signal.sdp! });
      else if (signal.kind === 'ice') third.onSignal({ kind: 'ice', candidate: signal.candidate! });
    });
    await third.offer();

    await expect.poll(() => refusals, { timeout: 15_000 }).toEqual(['handshake']);
    await expect.poll(() => third.ended, { timeout: 5_000 }).toBe(true);
    expect(thirdAdmitted).toBe(false);
    expect(linked).toEqual([]);
  }, 30_000);
});

describe('MeshPeerLink — admission gate', () => {
  it('the answerer refuses an offer advertising more than one DTLS fingerprint before creating a connection', async () => {
    let created = 0;
    const ended: TMeshLinkEnd[] = [];
    const endedWith: MeshLinkEndedError[] = [];
    const link = new MeshPeerLink({
      role: 'answerer',
      createPeer: () => {
        created += 1;
        return new RtcPeer();
      },
      sendSignal: () => undefined,
      startHandshake: () => {
        throw new Error('unreachable');
      },
      connectTimeoutMs: 5_000,
      onAdmitted: () => undefined,
      onEnded: (end, error) => {
        ended.push(end);
        endedWith.push(error);
      },
    });
    const offerer = await realOffer();
    const sdp = offerer.sdp.replace(
      /(a=fingerprint:[^\r\n]+\r\n)/,
      `$1a=fingerprint:sha-256 ${Array.from({ length: 32 }, () => 'AB').join(':')}\r\n`,
    );

    link.onSignal({ kind: 'offer', sdp });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ended).toEqual(['channel-binding']);
    expect(endedWith[0]).toMatchObject({ stage: 'connecting', role: 'answerer' });
    expect(endedWith[0]?.message).toMatch(/more than one DTLS fingerprint/);
    expect(created).toBe(0);
    offerer.close();
  });

  it('a frame that is not a handshake frame before admission is never delivered and ends the connection', async () => {
    const hub = createInMemoryMeshRelayHub();
    const low = node(hub, world.low);
    const refusals: TMeshLinkEnd[] = [];
    low.onRefusal((refusal) => refusals.push(refusal.end));
    const delivered: string[] = [];
    low.onLink((link) => link.onMessage((body) => delivered.push(body)));
    await low.start();

    // A peer holding the pair's inbox that smuggles a message ahead of its handshake.
    const topics = await (
      await derivePairRendezvous({
        ownKaPrivateKey: world.high.ka.privateKey,
        own: world.high.cert,
        peerDeviceId: world.low.cert.deviceId,
        lists: world.identity(world.high),
      })
    ).relayInbox();
    const relay = hub.connect();
    const instance = 'CCCCCCCCCCCCCCCCCCCCCC';
    let rogue: MeshPeerLink | undefined;
    relay.onMessage((_topic, data) => {
      const signal = data as {
        kind: string;
        from: string;
        cid: string;
        sdp?: string;
        candidate?: never;
      };
      if (signal.kind !== 'offer' && signal.kind !== 'ice') return;
      if (signal.kind === 'offer') {
        const send = (s: object): void =>
          relay.send(topics.outbound, {
            v: 1,
            from: instance,
            to: signal.from,
            cid: signal.cid,
            ...s,
          });
        rogue = new MeshPeerLink({
          role: 'answerer',
          createPeer: () => new RtcPeer(),
          sendSignal: send,
          startHandshake: (binding) => {
            binding.send({ t: 'mesh-msg', body: 'smuggled' });
            return startDeviceHandshake({
              role: 'responder',
              identity: world.identity(world.high),
              sessionDescriptor: world.high.session,
              localFingerprint: binding.localFingerprint,
              remoteFingerprint: binding.remoteFingerprint,
              locality: 'another-host',
              localPolicy: ALL_CAPABILITIES,
              send: binding.send,
            });
          },
          connectTimeoutMs: 10_000,
          onAdmitted: () => undefined,
          onEnded: () => undefined,
        });
        rogue.onSignal({ kind: 'offer', sdp: signal.sdp! });
      } else {
        rogue?.onSignal({ kind: 'ice', candidate: (data as { candidate: never }).candidate });
      }
    });
    relay.declarePresence([topics.inbound]);
    relay.send(topics.outbound, { v: 1, kind: 'hello', from: instance });

    await expect.poll(() => refusals, { timeout: 15_000 }).toEqual(['handshake']);
    expect(delivered).toEqual([]);
    rogue?.close();
  }, 30_000);
});
