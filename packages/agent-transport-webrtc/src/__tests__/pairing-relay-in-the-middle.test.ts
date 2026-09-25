import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { extractDtlsFingerprint, startPairingHandshake } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it, vi } from 'vitest';
import { RTCPeerConnection } from 'werift';

import { WebRtcTransport } from '../webrtc-transport.js';
import { createInMemorySignalingPair, type ISignalingClient } from '../signaling.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { TPairingFrame } from '@robota-sdk/agent-remote-pairing';
import type { RTCDataChannel } from 'werift';

/**
 * The pairing confirmation must bind to the certificate the DTLS layer actually verified. A relay that
 * terminates DTLS on both sides and forwards the data channel must not be able to make the two honest
 * peers compute the same binding.
 */

function createStubSession(): IInteractiveSession {
  return Object.assign(createTestInteractiveSession(), {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    getActiveDriverId: () => null,
    on: vi.fn(),
    off: vi.fn(),
  });
}

/** Insert `a=fingerprint:sha-256 <value>` before the first existing fingerprint line. */
function prependFingerprint(sdp: string, value: string): string {
  return sdp.replace(/^a=fingerprint:/m, `a=fingerprint:sha-256 ${value}\r\na=fingerprint:`);
}

type TDescription = { type: 'offer' | 'answer'; sdp: string };

/** Pairing responder on the far side. Resolves true only if its own handshake accepts. */
function connectResponder(signaling: ISignalingClient, secret: string): Promise<boolean> {
  return new Promise<boolean>((resolvePaired) => {
    const peer = new RTCPeerConnection();
    peer.onIceCandidate.subscribe((c) => {
      if (c) signaling.send({ kind: 'ice', data: c.toJSON() });
    });
    let hostFingerprint: string | undefined;
    let chain: Promise<void> = Promise.resolve();
    signaling.onSignal((message) => {
      chain = chain
        .then(async () => {
          if (message.kind === 'offer') {
            const offer = message.data as TDescription;
            hostFingerprint = extractDtlsFingerprint(offer.sdp);
            await peer.setRemoteDescription(offer);
            await peer.setLocalDescription(await peer.createAnswer());
            signaling.send({ kind: 'answer', data: peer.localDescription });
          } else if (message.kind === 'ice') {
            await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
          }
        })
        .catch(() => resolvePaired(false));
    });
    peer.onDataChannel.subscribe((channel) => {
      const controller = startPairingHandshake({
        secret,
        role: 'responder',
        localFingerprint: extractDtlsFingerprint(peer.localDescription!.sdp),
        remoteFingerprint: hostFingerprint!,
        send: (frame: TPairingFrame) => {
          try {
            channel.send(JSON.stringify(frame));
          } catch {
            /* closing */
          }
        },
        timeoutMs: 6000,
      });
      controller.result.then(
        () => resolvePaired(true),
        () => resolvePaired(false),
      );
      channel.onMessage.subscribe((data) => {
        try {
          controller.onFrame(JSON.parse(data.toString()) as TPairingFrame);
        } catch {
          /* ignore */
        }
      });
    });
  });
}

/**
 * A signaling relay that terminates DTLS with each side using its own certificates, forwards the data
 * channel between them, and advertises the honest peer's fingerprint FIRST next to its own.
 */
function startRelay(toHost: ISignalingClient, toRemote: ISignalingClient): void {
  const facingHost = new RTCPeerConnection();
  const facingRemote = new RTCPeerConnection();
  let hostChannel: RTCDataChannel | undefined;
  const remoteChannel = facingRemote.createDataChannel('robota-session');
  const toRemoteQueue: string[] = [];
  const toHostQueue: string[] = [];
  let hostFingerprint = '';
  let pendingHostOffer: TDescription | undefined;

  facingHost.onIceCandidate.subscribe((c) => {
    if (c) toHost.send({ kind: 'ice', data: c.toJSON() });
  });
  facingRemote.onIceCandidate.subscribe((c) => {
    if (c) toRemote.send({ kind: 'ice', data: c.toJSON() });
  });

  facingHost.onDataChannel.subscribe((channel) => {
    hostChannel = channel;
    for (const m of toHostQueue.splice(0)) channel.send(m);
    channel.onMessage.subscribe((data) => {
      const text = data.toString();
      if (remoteChannel.readyState === 'open') remoteChannel.send(text);
      else toRemoteQueue.push(text);
    });
  });
  remoteChannel.stateChanged.subscribe((state) => {
    if (state === 'open') for (const m of toRemoteQueue.splice(0)) remoteChannel.send(m);
  });
  remoteChannel.onMessage.subscribe((data) => {
    const text = data.toString();
    if (hostChannel) hostChannel.send(text);
    else toHostQueue.push(text);
  });

  let hostChain: Promise<void> = Promise.resolve();
  toHost.onSignal((message) => {
    hostChain = hostChain.then(async () => {
      if (message.kind === 'offer') {
        pendingHostOffer = message.data as TDescription;
        hostFingerprint = extractDtlsFingerprint(pendingHostOffer.sdp);
        await facingRemote.setLocalDescription(await facingRemote.createOffer());
        const own = facingRemote.localDescription!;
        toRemote.send({
          kind: 'offer',
          data: { type: 'offer', sdp: prependFingerprint(own.sdp, hostFingerprint) },
        });
      } else if (message.kind === 'ice') {
        await facingHost.addIceCandidate(message.data as Parameters<typeof facingHost.addIceCandidate>[0]);
      }
    });
  });

  let remoteChain: Promise<void> = Promise.resolve();
  toRemote.onSignal((message) => {
    remoteChain = remoteChain.then(async () => {
      if (message.kind === 'answer') {
        const answer = message.data as TDescription;
        const remoteFingerprint = extractDtlsFingerprint(answer.sdp);
        await facingRemote.setRemoteDescription(answer);
        await facingHost.setRemoteDescription(pendingHostOffer!);
        await facingHost.setLocalDescription(await facingHost.createAnswer());
        const own = facingHost.localDescription!;
        toHost.send({
          kind: 'answer',
          data: { type: 'answer', sdp: prependFingerprint(own.sdp, remoteFingerprint) },
        });
      } else if (message.kind === 'ice') {
        await facingRemote.addIceCandidate(
          message.data as Parameters<typeof facingRemote.addIceCandidate>[0],
        );
      }
    });
  });
}

describe('WebRTC pairing with a relay in the middle', () => {
  it('refuses to pair when the relay advertises the honest fingerprint next to its own', async () => {
    const secret = 'shared-secret-256bit-base64url-relay';
    const [hostSig, relayHostSide] = createInMemorySignalingPair();
    const [relayRemoteSide, remoteSig] = createInMemorySignalingPair();
    const session = createStubSession();
    const onPaired = vi.fn();
    const transport = new WebRtcTransport({ signaling: hostSig, secret, onPaired });
    transport.attach(session);

    startRelay(relayHostSide, relayRemoteSide);
    const remotePaired = connectResponder(remoteSig, secret);
    await transport.start();

    await expect(remotePaired).resolves.toBe(false);
    expect(onPaired).not.toHaveBeenCalled();
    await transport.stop();
  }, 20000);
});

describe('WebRTC transport answer handling', () => {
  it('takes one answer per start and ignores any later one', async () => {
    let remoteDescriptions = 0;
    class CountingPeer extends RTCPeerConnection {
      override async setRemoteDescription(
        ...args: Parameters<RTCPeerConnection['setRemoteDescription']>
      ): ReturnType<RTCPeerConnection['setRemoteDescription']> {
        remoteDescriptions += 1;
        return super.setRemoteDescription(...args);
      }
    }
    const [hostSig, remoteSig] = createInMemorySignalingPair();
    const transport = new WebRtcTransport({
      signaling: hostSig,
      secret: 'shared-secret-256bit-base64url-answers',
      loadWerift: () => ({ RTCPeerConnection: CountingPeer }) as never,
    });
    transport.attach(createStubSession());

    const remote = new RTCPeerConnection();
    const answered = new Promise<void>((resolve) => {
      remoteSig.onSignal((message) => {
        if (message.kind !== 'offer') return;
        void (async () => {
          await remote.setRemoteDescription(message.data as TDescription);
          await remote.setLocalDescription(await remote.createAnswer());
          remoteSig.send({ kind: 'answer', data: remote.localDescription });
          remoteSig.send({ kind: 'answer', data: remote.localDescription });
          setTimeout(resolve, 200);
        })();
      });
    });
    await transport.start();
    await answered;

    expect(remoteDescriptions).toBe(1);
    await transport.stop();
    await remote.close();
  }, 15000);
});
