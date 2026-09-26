import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { describe, expect, it, vi } from 'vitest';
import { RtcPeer, WebRtcTransport, WsSignalingClient } from '@robota-sdk/agent-transport-webrtc';

import { startSignalingServer } from '../server.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

/**
 * REMOTE-004 B2 TC-01 — full end-to-end over the REAL relay (no in-memory pair): a `WebRtcTransport` (offerer)
 * and a real answerer each reach the running `startSignalingServer()` via a production `WsSignalingClient`,
 * establish a real `RTCDataChannel`, and round-trip a `TClientMessage`→session→`TServerMessage` through the
 * reused `createWsHandler`. A strict superset of Stage A's in-memory TC-03.
 */

function createStubSession(): IInteractiveSession {
  return Object.assign(createTestInteractiveSession(), {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    on: vi.fn(),
    off: vi.fn(),
  });
}

/**
 * The answerer: reaches the relay via its own `WsSignalingClient`, mirrors the serialized signal-chain pattern.
 * Resolves `ready` once it has joined the rendezvous (so the offerer only offers when a counterpart is present —
 * the relay forwards only to peers currently in the room; offerer-first "wait for remote" orchestration is B4),
 * and resolves `reply` with the first `TServerMessage` received over the data channel.
 */
function connectRemoteAnswerer(
  url: string,
  rendezvous: string,
): { ready: Promise<void>; reply: Promise<Record<string, unknown>> } {
  let markReady!: () => void;
  const ready = new Promise<void>((r) => (markReady = r));
  const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
    const peer = new RtcPeer();
    const signaling = new WsSignalingClient({
      url,
      rendezvous,
      onError: reject,
      onReady: markReady,
    });

    peer.onLocalCandidate((c) =>
      signaling.send({ kind: 'ice', data: { candidate: c.candidate, sdpMid: c.mid } }),
    );

    let chain: Promise<void> = Promise.resolve();
    signaling.onSignal((message) => {
      chain = chain
        .then(async () => {
          const data = message.data as { sdp?: string; candidate?: string; sdpMid?: string };
          if (message.kind === 'offer') {
            const sdp = await peer.acceptOffer(data.sdp!);
            signaling.send({ kind: 'answer', data: { type: 'answer', sdp } });
          } else if (message.kind === 'ice') {
            peer.addRemoteCandidate({ candidate: data.candidate!, mid: data.sdpMid ?? '0' });
          }
        })
        .catch(reject);
    });

    peer.onDataChannel((channel) => {
      const ask = (): void => channel.send(JSON.stringify({ type: 'get-messages' }));
      if (channel.readyState === 'open') ask();
      else channel.onStateChange((state) => state === 'open' && ask());
      channel.onMessage((text) => resolve(JSON.parse(text) as Record<string, unknown>));
    });
  });
  return { ready, reply };
}

describe('WebRtc P2P over the real signaling relay (REMOTE-004 B2 — TC-01)', () => {
  it('round-trips a session message over a real RTCDataChannel established through the relay', async () => {
    const server = await startSignalingServer(); // 127.0.0.1 : ephemeral
    const url = `ws://127.0.0.1:${server.port}`;
    const rendezvous = 'e2e-rendezvous';

    const session = createStubSession();
    const hostSignaling = new WsSignalingClient({ url, rendezvous });
    const host = new WebRtcTransport({
      signaling: hostSignaling,
      // SEC-008: this case is about the SIGNALLING RELAY — that an offer and an answer find each
      // other through it and a message round-trips. Pairing is a different subject with its own
      // suite, so the transport is opened deliberately rather than by omitting a field.
      open: true,
      openReason: 'relay integration — the pairing gate is exercised by the pairing suite',
    });
    host.attach(session);

    // Bring the answerer into the rendezvous FIRST, then let the host offer (counterpart must be present).
    const remote = connectRemoteAnswerer(url, rendezvous);
    await remote.ready;
    await host.start();

    const reply = await remote.reply;
    expect(reply.type).toBe('messages');
    expect(reply.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(session.getMessages).toHaveBeenCalled();

    await host.stop();
    hostSignaling.close();
    await server.close();
  }, 20000);
});
