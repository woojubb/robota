import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createRtcSessionClient, type TRtcConnectionStatus } from '../rtc-session-client.js';

import {
  exportPublicKey,
  generateIdentityKeyPair,
  type startDeviceReconnect,
} from '@robota-sdk/agent-remote-pairing';

import type { IDeviceCredential, IDeviceCredentialStore } from '../device-credential-store.js';
import type { ISignalMessage, ISignalingClient } from '../rtc-signaling.js';
import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { TServerMessage } from '@robota-sdk/agent-transport';

/**
 * REMOTE-009 Step 2 — `createRtcSessionClient` answerer glue: receive the host offer → create + send an
 * answer (capturing fingerprints) → wire the data channel through the responder gate → expose the session
 * only after pairing accepts. Driven with a fake signaling + fake `RTCPeerConnection` + injected handshake.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const NATIVE_ANSWER = readFileSync(join(__dirname, 'fixtures/native-browser-answer.sdp'), 'utf8');
const OFFER_SDP =
  'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AA:BB\r\n';

/** A controllable fake native RTCPeerConnection (data-channel answerer). */
function makeFakePeer() {
  let dataHandler: ((e: { channel: unknown }) => void) | null = null;
  const peer = {
    onicecandidate: null as unknown,
    set ondatachannel(h: (e: { channel: unknown }) => void) {
      dataHandler = h;
    },
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: NATIVE_ANSWER }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    localDescription: { type: 'answer', sdp: NATIVE_ANSWER },
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
  return { peer, fireDataChannel: (channel: unknown) => dataHandler?.({ channel }) };
}

function makeHandshakeStub(sessionKey = 'k') {
  let resolveResult!: (v: { sessionKey: string }) => void;
  const start: typeof startPairingHandshake = (options) => {
    options.send({ t: 'pair-nonce', nonce: 'stub' });
    return {
      result: new Promise<{ sessionKey: string }>((res) => (resolveResult = res)),
      onFrame: (_f: TPairingFrame) => {},
    };
  };
  return { start, accept: () => resolveResult({ sessionKey }) };
}

describe('createRtcSessionClient (REMOTE-009 Step 2)', () => {
  it('answers the offer, pairs, and exposes the session only post-accept', async () => {
    let onSignal: ((m: ISignalMessage) => void) | null = null;
    const sentSignals: ISignalMessage[] = [];
    const fakeSignaling: ISignalingClient = {
      send: (m) => sentSignals.push(m),
      onSignal: (h) => {
        onSignal = h;
        return () => {};
      },
      close: vi.fn(),
    };
    const { peer, fireDataChannel } = makeFakePeer();
    const hs = makeHandshakeStub();
    const statuses: TRtcConnectionStatus[] = [];
    const messages: TServerMessage[] = [];

    const client = createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        createSignaling: () => fakeSignaling,
        createPeer: () => peer as unknown as RTCPeerConnection,
        startHandshake: hs.start,
      },
      { onMessage: (m) => messages.push(m), onStatusChange: (s) => statuses.push(s) },
    );

    client.connect();
    expect(statuses).toContain('connecting');

    // Host sends the offer → the client answers.
    onSignal!({ kind: 'offer', data: { type: 'offer', sdp: OFFER_SDP } });
    await new Promise((r) => setTimeout(r, 0)); // let the async answer chain run
    const answer = sentSignals.find((s) => s.kind === 'answer');
    expect(answer).toBeDefined();
    expect(peer.createAnswer).toHaveBeenCalled();

    // Data channel opens → pairing phase; nothing exposed yet.
    const channel = { send: vi.fn(), close: vi.fn(), onmessage: null as unknown };
    fireDataChannel(channel);
    expect(statuses).toContain('pairing');
    (channel.onmessage as (e: { data: string }) => void)({
      data: JSON.stringify({ type: 'messages', messages: [] }),
    });
    expect(messages).toHaveLength(0); // pre-accept non-pairing frame dropped

    // Pairing accepts → get-messages sent; the host operator has not admitted the connection yet.
    hs.accept();
    await Promise.resolve();
    expect(statuses.at(-1)).toBe('awaiting-approval');
    expect(statuses).not.toContain('connected');
    expect(JSON.parse((channel.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toEqual({
      type: 'get-messages',
    });
    // The host's first session frame is its admission → connected, and session frames are delivered.
    (channel.onmessage as (e: { data: string }) => void)({
      data: JSON.stringify({ type: 'text_delta', delta: 'hi' }),
    });
    expect(statuses.at(-1)).toBe('connected');
    expect(messages).toContainEqual({ type: 'text_delta', delta: 'hi' });

    client.disconnect();
    expect(statuses.at(-1)).toBe('disconnected');
  });

  it('says the host refused when the channel closes before the host admitted it', async () => {
    let onSignal: ((m: ISignalMessage) => void) | null = null;
    const fakeSignaling: ISignalingClient = {
      send: vi.fn(),
      onSignal: (h) => {
        onSignal = h;
        return () => {};
      },
      close: vi.fn(),
    };
    const { peer, fireDataChannel } = makeFakePeer();
    const hs = makeHandshakeStub();
    const statuses: TRtcConnectionStatus[] = [];
    const client = createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        createSignaling: () => fakeSignaling,
        createPeer: () => peer as unknown as RTCPeerConnection,
        startHandshake: hs.start,
      },
      { onMessage: vi.fn(), onStatusChange: (s) => statuses.push(s) },
    );
    client.connect();
    onSignal!({ kind: 'offer', data: { type: 'offer', sdp: OFFER_SDP } });
    await new Promise((r) => setTimeout(r, 0));
    const channel = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null as unknown,
      onclose: null as unknown,
    };
    fireDataChannel(channel);
    hs.accept();
    await Promise.resolve();
    expect(statuses.at(-1)).toBe('awaiting-approval');
    // The host operator said no: the host closes the channel without a session frame.
    (channel.onclose as () => void)();
    expect(statuses.at(-1)).toBe('refused');
    expect(statuses).not.toContain('connected');
    client.disconnect();
  });

  /** A client whose signaling, peers and data channels the test drives, one connection at a time. */
  function harness(extra: Partial<Parameters<typeof createRtcSessionClient>[0]> = {}) {
    const rooms: ((m: ISignalMessage) => void)[] = [];
    const peers: ReturnType<typeof makeFakePeer>[] = [];
    const statuses: TRtcConnectionStatus[] = [];
    const client = createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        createSignaling: () => ({
          send: vi.fn(),
          onSignal: (h) => {
            rooms.push(h);
            return () => {};
          },
          close: vi.fn(),
        }),
        createPeer: () => {
          const fake = makeFakePeer();
          peers.push(fake);
          return fake.peer as unknown as RTCPeerConnection;
        },
        ...extra,
      },
      { onMessage: vi.fn(), onStatusChange: (st) => statuses.push(st) },
    );
    /** Offer on the latest room, then open a data channel on the latest peer. */
    const open = async () => {
      rooms.at(-1)!({ kind: 'offer', data: { type: 'offer', sdp: OFFER_SDP } });
      await new Promise((r) => setTimeout(r, 0));
      const channel = {
        send: vi.fn(),
        close: vi.fn(),
        onmessage: null as unknown,
        onclose: null as unknown,
      };
      peers.at(-1)!.fireDataChannel(channel);
      const deliver = (frame: unknown) =>
        (channel.onmessage as (e: { data: string }) => void)({ data: JSON.stringify(frame) });
      const sent = () =>
        (channel.send as ReturnType<typeof vi.fn>).mock.calls.map(([d]) => JSON.parse(d as string));
      return { channel, deliver, sent };
    };
    /** The latest peer's connection moves to `state`. */
    const drop = (state: RTCPeerConnectionState) => {
      const fake = peers.at(-1)!.peer as unknown as RTCPeerConnection & {
        connectionState: RTCPeerConnectionState;
        onconnectionstatechange: () => void;
      };
      fake.connectionState = state;
      fake.onconnectionstatechange();
    };
    return { client, statuses, peers, rooms, open, drop };
  }

  it('a first connection lost before the host admitted it fails; a passing blip does not', async () => {
    const hs = makeHandshakeStub();
    const h = harness({ startHandshake: hs.start });
    h.client.connect();
    const { deliver } = await h.open();
    hs.accept();
    await Promise.resolve();
    h.drop('disconnected');
    expect(h.statuses.at(-1)).toBe('awaiting-approval');
    deliver({ type: 'messages', messages: [] });
    expect(h.statuses.at(-1)).toBe('connected');

    h.client.disconnect();

    const hs2 = makeHandshakeStub();
    const lost = harness({ startHandshake: hs2.start });
    lost.client.connect();
    await lost.open();
    hs2.accept();
    await Promise.resolve();
    lost.drop('failed');
    expect(lost.statuses.at(-1)).toBe('failed');
    expect(lost.statuses).not.toContain('refused');
  });

  it('a warm reconnect waits for the host to admit it too, and asks something the host answers', async () => {
    const hostKey = await generateIdentityKeyPair(true);
    const hostSpki = await exportPublicKey(hostKey.publicKey);
    const saved = new Map<string, IDeviceCredential>();
    const deviceCredentials: IDeviceCredentialStore = {
      get: async (origin, host) => saved.get(`${origin}|${host}`),
      save: async (origin, host, credential) => void saved.set(`${origin}|${host}`, credential),
      remove: async (origin, host) => void saved.delete(`${origin}|${host}`),
    };
    // A real session key: the reconnect seed is derived from it.
    const hs = makeHandshakeStub('A'.repeat(43));
    const startReconnect = (() => ({
      result: Promise.resolve(),
      onFrame: () => {},
    })) as unknown as typeof startDeviceReconnect;
    const h = harness({
      startHandshake: hs.start,
      deviceCredentials,
      startReconnect,
      reconnectRoomWaitMs: 50,
    });

    // First pairing, enrollment, then the host admits it.
    h.client.connect();
    const first = await h.open();
    // The device keypair is built async; the gate starts pairing once it exists.
    await vi.waitFor(() => expect(first.sent()).toContainEqual({ t: 'pair-nonce', nonce: 'stub' }));
    hs.accept();
    await Promise.resolve();
    first.deliver({ t: 'enroll-key', spki: hostSpki });
    await vi.waitFor(() => expect(h.statuses.at(-1)).toBe('awaiting-approval'));
    first.deliver({ type: 'messages', messages: [] });
    expect(h.statuses.at(-1)).toBe('connected');
    await vi.waitFor(() => expect(saved.size).toBe(1));
    await new Promise((r) => setTimeout(r, 0)); // the reconnect context is captured after the save

    // The link drops; the client rediscovers the host and reconnects as this device.
    h.drop('disconnected');
    await vi.waitFor(() => expect(h.rooms).toHaveLength(2));
    const second = await h.open();
    await vi.waitFor(() => expect(h.statuses.at(-1)).toBe('awaiting-approval'));
    expect(second.sent().slice(-2)).toEqual([
      { type: 'resume', lastSeq: 0 },
      { type: 'get-executing' },
    ]);
    // The old channel closing late says nothing about this connection.
    (first.channel.onclose as () => void)();
    expect(h.statuses.at(-1)).toBe('awaiting-approval');
    second.deliver({ type: 'executing', executing: false });
    expect(h.statuses.at(-1)).toBe('connected');
    h.client.disconnect();
  });

  it('takes one offer per connection and ignores any later one', async () => {
    let onSignal: ((m: ISignalMessage) => void) | null = null;
    const fakeSignaling: ISignalingClient = {
      send: vi.fn(),
      onSignal: (h) => {
        onSignal = h;
        return () => {};
      },
      close: vi.fn(),
    };
    const { peer } = makeFakePeer();
    const client = createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        createSignaling: () => fakeSignaling,
        createPeer: () => peer as unknown as RTCPeerConnection,
        startHandshake: makeHandshakeStub().start,
      },
      { onMessage: vi.fn(), onStatusChange: vi.fn() },
    );
    client.connect();
    // A later offer would add fingerprints the DTLS layer would also accept.
    onSignal!({ kind: 'offer', data: { type: 'offer', sdp: OFFER_SDP } });
    onSignal!({ kind: 'offer', data: { type: 'offer', sdp: OFFER_SDP } });
    await new Promise((r) => setTimeout(r, 0));
    expect(peer.setRemoteDescription).toHaveBeenCalledTimes(1);
    client.disconnect();
  });

  it('fails closed on an offer that advertises two different fingerprints', async () => {
    let onSignal: ((m: ISignalMessage) => void) | null = null;
    const fakeSignaling: ISignalingClient = {
      send: vi.fn(),
      onSignal: (h) => {
        onSignal = h;
        return () => {};
      },
      close: vi.fn(),
    };
    const { peer } = makeFakePeer();
    const statuses: TRtcConnectionStatus[] = [];
    const client = createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        createSignaling: () => fakeSignaling,
        createPeer: () => peer as unknown as RTCPeerConnection,
        startHandshake: makeHandshakeStub().start,
      },
      { onMessage: vi.fn(), onStatusChange: (s) => statuses.push(s) },
    );
    client.connect();
    onSignal!({
      kind: 'offer',
      data: { type: 'offer', sdp: `${OFFER_SDP}a=fingerprint:sha-256 CC:DD\r\n` },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('failed');
  });

  it('REMOTE-010: threads iceServers + forceTurn (iceTransportPolicy: relay) into the peer config', () => {
    const iceServers = [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'p' }];
    let peerConfig: RTCConfiguration | undefined;
    createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        iceServers,
        forceTurn: true,
        createSignaling: () => ({ send: vi.fn(), onSignal: () => () => {}, close: vi.fn() }),
        createPeer: (config) => {
          peerConfig = config;
          return makeFakePeer().peer as unknown as RTCPeerConnection;
        },
      },
      { onMessage: vi.fn(), onStatusChange: vi.fn() },
    ).connect();
    expect(peerConfig).toEqual({ iceServers, iceTransportPolicy: 'relay' });
  });

  it('a signaling error fails the client closed', () => {
    const statuses: TRtcConnectionStatus[] = [];
    let capturedOnError: (() => void) | undefined;
    const client = createRtcSessionClient(
      {
        relayUrl: 'wss://r',
        rendezvous: 'rv',
        secret: 's',
        createSignaling: (opts) => {
          capturedOnError = opts.onError as () => void;
          return { send: vi.fn(), onSignal: () => () => {}, close: vi.fn() };
        },
        createPeer: () => makeFakePeer().peer as unknown as RTCPeerConnection,
      },
      { onMessage: vi.fn(), onStatusChange: (s) => statuses.push(s) },
    );
    client.connect();
    capturedOnError?.();
    expect(statuses).toContain('failed');
  });
});
