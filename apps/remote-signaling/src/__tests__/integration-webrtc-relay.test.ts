import { describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import { WebRtcTransport, WsSignalingClient } from '@robota-sdk/agent-transport-webrtc';

import { startSignalingServer } from '../server.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-004 B2 TC-01 — full end-to-end over the REAL relay (no in-memory pair): a `WebRtcTransport` (offerer)
 * and a werift answerer each reach the running `startSignalingServer()` via a production `WsSignalingClient`,
 * establish a real `RTCDataChannel`, and round-trip a `TClientMessage`→session→`TServerMessage` through the
 * reused `createWsHandler`. A strict superset of Stage A's in-memory TC-03.
 */

function createStubSession(): IInteractiveSession {
  return {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IInteractiveSession;
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
    const peer = new RTCPeerConnection();
    const signaling = new WsSignalingClient({
      url,
      rendezvous,
      onError: reject,
      onReady: markReady,
    });

    peer.onIceCandidate.subscribe((candidate) => {
      if (candidate) signaling.send({ kind: 'ice', data: candidate.toJSON() });
    });

    let chain: Promise<void> = Promise.resolve();
    signaling.onSignal((message) => {
      chain = chain
        .then(async () => {
          if (message.kind === 'offer') {
            await peer.setRemoteDescription(
              message.data as Parameters<typeof peer.setRemoteDescription>[0],
            );
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            signaling.send({ kind: 'answer', data: peer.localDescription });
          } else if (message.kind === 'ice') {
            await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
          }
        })
        .catch(reject);
    });

    peer.onDataChannel.subscribe((channel) => {
      channel.stateChanged.subscribe((state) => {
        if (state === 'open') channel.send(JSON.stringify({ type: 'get-messages' }));
      });
      channel.onMessage.subscribe((data) => {
        resolve(JSON.parse(typeof data === 'string' ? data : data.toString()));
      });
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
    const host = new WebRtcTransport({ signaling: hostSignaling });
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
