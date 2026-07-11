import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createRtcSessionClient, type TRtcConnectionStatus } from '../rtc-session-client.js';

import type { ISignalMessage, ISignalingClient } from '../rtc-signaling.js';
import type { startPairingHandshake, TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

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

function makeHandshakeStub() {
  let resolveResult!: (v: { sessionKey: string }) => void;
  const start: typeof startPairingHandshake = (options) => {
    options.send({ t: 'pair-nonce', nonce: 'stub' });
    return {
      result: new Promise<{ sessionKey: string }>((res) => (resolveResult = res)),
      onFrame: (_f: TPairingFrame) => {},
    };
  };
  return { start, accept: () => resolveResult({ sessionKey: 'k' }) };
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

    // Pairing accepts → connected, get-messages sent, session frames now delivered.
    hs.accept();
    await Promise.resolve();
    expect(statuses).toContain('connected');
    expect(JSON.parse((channel.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0])).toEqual({
      type: 'get-messages',
    });
    (channel.onmessage as (e: { data: string }) => void)({
      data: JSON.stringify({ type: 'text_delta', delta: 'hi' }),
    });
    expect(messages).toContainEqual({ type: 'text_delta', delta: 'hi' });

    client.disconnect();
    expect(statuses.at(-1)).toBe('disconnected');
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
