import { describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

import { WebRtcTransport } from '../webrtc-transport.js';
import { createInMemorySignalingPair, type ISignalingClient } from '../signaling.js';

/** Minimal stub session — only `getMessages` + no-op `on`/`off` are exercised by the get-messages round-trip. */
function createStubSession(): IInteractiveSession {
  return {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IInteractiveSession;
}

/**
 * The remote peer (answerer): consumes the host's offer via the injected signaling, opens the data channel,
 * and speaks the `TClientMessage`/`TServerMessage` protocol. Resolves with the first `TServerMessage` received.
 */
function connectRemote(signaling: ISignalingClient): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const peer = new RTCPeerConnection();
    peer.onIceCandidate.subscribe((c) => {
      if (c) signaling.send({ kind: 'ice', data: c.toJSON() });
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
}

describe('WebRtcTransport (REMOTE-002 Stage A — loopback)', () => {
  it('has the collapsed webrtc metadata and is disabled by default', () => {
    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({ signaling: sig });
    expect(t.name).toBe('webrtc');
    expect(t.defaultEnabled).toBe(false);
  });

  it('start() before attach() throws', async () => {
    const [sig] = createInMemorySignalingPair();
    const t = new WebRtcTransport({ signaling: sig });
    await expect(t.start()).rejects.toThrow(/attach\(\) must be called/);
  });

  it('TC-03: establishes an RTCDataChannel between two peers and round-trips TClient→session→TServer through the shared handler', async () => {
    const [hostSig, remoteSig] = createInMemorySignalingPair();
    const session = createStubSession();
    const host = new WebRtcTransport({ signaling: hostSig });
    host.attach(session);

    const remoteReply = connectRemote(remoteSig);
    await host.start();

    const reply = await remoteReply;
    // The remote's `get-messages` reached the session via the reused handler; the host streamed back a
    // `messages` TServerMessage carrying the stub session's messages — a full P2P round-trip, no network.
    expect(reply.type).toBe('messages');
    expect(reply.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(session.getMessages).toHaveBeenCalled();

    await host.stop();
  }, 15000);
});
