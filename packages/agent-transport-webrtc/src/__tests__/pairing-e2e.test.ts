import { extractDtlsFingerprint, startPairingHandshake } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';

import { WebRtcTransport } from '../webrtc-transport.js';
import { createInMemorySignalingPair, type ISignalingClient } from '../signaling.js';

import type { TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-008 Step 1/5 — end-to-end PAIRED handshake over a REAL werift data channel. The host is a
 * `WebRtcTransport` with a `secret` (initiator ≡ offerer); the "remote device" here runs the RESPONDER
 * side of the same pairing handshake, then speaks the session protocol only after its own accept. Proves
 * the gate's routing switch works over a real channel: matching secrets → session exposed + round-trips;
 * mismatched secrets → both reject, session never exposed (fail closed).
 */

function createStubSession(): IInteractiveSession {
  return {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as IInteractiveSession;
}

interface IRemoteResult {
  /** Resolves with the first session `TServerMessage` (only reachable if pairing accepted). */
  session: Promise<Record<string, unknown>>;
  /** Resolves true if the responder's pairing accepted, false if it rejected/closed. */
  paired: Promise<boolean>;
}

/**
 * The remote device (answerer + pairing RESPONDER). Extracts the host fingerprint from the offer and its
 * own from the answer, runs the responder handshake over the data channel, and — on accept — sends a
 * `get-messages` session frame. Session frames are only sent post-accept (phase separation).
 */
function connectRemotePaired(signaling: ISignalingClient, secret: string): IRemoteResult {
  let resolveSession!: (v: Record<string, unknown>) => void;
  let resolvePaired!: (v: boolean) => void;
  const session = new Promise<Record<string, unknown>>((res) => (resolveSession = res));
  const paired = new Promise<boolean>((res) => (resolvePaired = res));

  const peer = new RTCPeerConnection();
  peer.onIceCandidate.subscribe((c) => {
    if (c) signaling.send({ kind: 'ice', data: c.toJSON() });
  });

  let hostFingerprint: string | undefined;
  let chain: Promise<void> = Promise.resolve();
  signaling.onSignal((message) => {
    chain = chain.then(async () => {
      if (message.kind === 'offer') {
        const offer = message.data as { sdp: string } & Parameters<
          typeof peer.setRemoteDescription
        >[0];
        hostFingerprint = extractDtlsFingerprint(offer.sdp);
        await peer.setRemoteDescription(offer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        signaling.send({ kind: 'answer', data: peer.localDescription });
      } else if (message.kind === 'ice') {
        await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
      }
    });
  });

  peer.onDataChannel.subscribe((channel) => {
    let accepted = false;
    const controller = startPairingHandshake({
      secret,
      role: 'responder',
      localFingerprint: extractDtlsFingerprint(peer.localDescription!.sdp),
      remoteFingerprint: hostFingerprint!,
      send: (frame: TPairingFrame) => {
        try {
          channel.send(JSON.stringify(frame));
        } catch {
          /* channel closing */
        }
      },
      timeoutMs: 8000,
    });
    controller.result.then(
      () => {
        accepted = true;
        resolvePaired(true);
        channel.send(JSON.stringify({ type: 'get-messages' }));
      },
      () => resolvePaired(false),
    );
    channel.onMessage.subscribe((data) => {
      const text = typeof data === 'string' ? data : data.toString();
      if (!accepted) {
        // Pre-accept only pairing frames arrive; route them to the handshake.
        try {
          controller.onFrame(JSON.parse(text) as TPairingFrame);
        } catch {
          /* ignore */
        }
        return;
      }
      resolveSession(JSON.parse(text) as Record<string, unknown>);
    });
  });

  return { session, paired };
}

describe('WebRtc pairing end-to-end (REMOTE-008)', () => {
  it('matching secrets: both peers pair, the session is exposed, and get-messages round-trips', async () => {
    const secret = 'shared-secret-256bit-base64url-xyz';
    const [hostSig, remoteSig] = createInMemorySignalingPair();
    const transport = new WebRtcTransport({ signaling: hostSig, secret });
    transport.attach(createStubSession());

    const remote = connectRemotePaired(remoteSig, secret);
    await transport.start();

    await expect(remote.paired).resolves.toBe(true);
    const reply = await remote.session;
    expect(reply.type).toBe('messages');
    await transport.stop();
  }, 20000);

  it('mismatched secrets: both reject, the session is never exposed (fail closed)', async () => {
    const [hostSig, remoteSig] = createInMemorySignalingPair();
    const session = createStubSession();
    const transport = new WebRtcTransport({ signaling: hostSig, secret: 'host-secret' });
    transport.attach(session);

    const remote = connectRemotePaired(remoteSig, 'different-secret');
    await transport.start();

    await expect(remote.paired).resolves.toBe(false);
    // The host never built the session bridge → getMessages was never invoked over the channel.
    expect(session.getMessages as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    await transport.stop();
  }, 20000);
});
