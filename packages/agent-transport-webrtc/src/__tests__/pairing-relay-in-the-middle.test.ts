import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { extractDtlsFingerprint, startPairingHandshake } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it, vi } from 'vitest';

import { WebRtcTransport } from '../webrtc-transport.js';
import { RtcPeer, type RtcChannel } from '../rtc-peer.js';
import { createInMemorySignalingPair, type ISignalingClient } from '../signaling.js';
import { fakeDataChannel } from './fake-datachannel.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { TPairingFrame } from '@robota-sdk/agent-remote-pairing';

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
type TCandidate = { candidate: string; sdpMid?: string };

function sendCandidates(peer: RtcPeer, signaling: ISignalingClient): void {
  peer.onLocalCandidate((c) =>
    signaling.send({ kind: 'ice', data: { candidate: c.candidate, sdpMid: c.mid } }),
  );
}

function addCandidate(peer: RtcPeer, data: unknown): void {
  const c = data as TCandidate;
  peer.addRemoteCandidate({ candidate: c.candidate, mid: c.sdpMid ?? '0' });
}

/** Pairing responder on the far side. Resolves true only if its own handshake accepts. */
function connectResponder(signaling: ISignalingClient, secret: string): Promise<boolean> {
  return new Promise<boolean>((resolvePaired) => {
    const peer = new RtcPeer();
    sendCandidates(peer, signaling);
    let hostFingerprint: string | undefined;
    let localFingerprint: string | undefined;
    let chain: Promise<void> = Promise.resolve();
    signaling.onSignal((message) => {
      chain = chain
        .then(async () => {
          if (message.kind === 'offer') {
            const offer = message.data as TDescription;
            hostFingerprint = extractDtlsFingerprint(offer.sdp);
            const answer = await peer.acceptOffer(offer.sdp);
            localFingerprint = extractDtlsFingerprint(answer);
            signaling.send({ kind: 'answer', data: { type: 'answer', sdp: answer } });
          } else if (message.kind === 'ice') {
            addCandidate(peer, message.data);
          }
        })
        .catch(() => resolvePaired(false));
    });
    peer.onDataChannel((channel) => {
      const controller = startPairingHandshake({
        secret,
        role: 'responder',
        localFingerprint: localFingerprint!,
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
      channel.onMessage((text) => {
        try {
          controller.onFrame(JSON.parse(text) as TPairingFrame);
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
  const facingHost = new RtcPeer();
  const facingRemote = new RtcPeer();
  let hostChannel: RtcChannel | undefined;
  const remoteChannel = facingRemote.createDataChannel('robota-session');
  const toRemoteQueue: string[] = [];
  const toHostQueue: string[] = [];
  let pendingHostOffer: TDescription | undefined;

  sendCandidates(facingHost, toHost);
  sendCandidates(facingRemote, toRemote);

  facingHost.onDataChannel((channel) => {
    hostChannel = channel;
    for (const m of toHostQueue.splice(0)) channel.send(m);
    channel.onMessage((text) => {
      if (remoteChannel.readyState === 'open') remoteChannel.send(text);
      else toRemoteQueue.push(text);
    });
  });
  remoteChannel.onStateChange((state) => {
    if (state === 'open') for (const m of toRemoteQueue.splice(0)) remoteChannel.send(m);
  });
  remoteChannel.onMessage((text) => {
    if (hostChannel) hostChannel.send(text);
    else toHostQueue.push(text);
  });

  let hostChain: Promise<void> = Promise.resolve();
  toHost.onSignal((message) => {
    hostChain = hostChain
      .then(async () => {
        if (message.kind === 'offer') {
          pendingHostOffer = message.data as TDescription;
          const hostFingerprint = extractDtlsFingerprint(pendingHostOffer.sdp);
          const own = await facingRemote.createOffer();
          toRemote.send({
            kind: 'offer',
            data: { type: 'offer', sdp: prependFingerprint(own, hostFingerprint) },
          });
        } else if (message.kind === 'ice') {
          addCandidate(facingHost, message.data);
        }
      })
      .catch(() => undefined);
  });

  let remoteChain: Promise<void> = Promise.resolve();
  toRemote.onSignal((message) => {
    remoteChain = remoteChain
      .then(async () => {
        if (message.kind === 'answer') {
          const answer = message.data as TDescription;
          const remoteFingerprint = extractDtlsFingerprint(answer.sdp);
          facingRemote.acceptAnswer(answer.sdp);
          const own = await facingHost.acceptOffer(pendingHostOffer!.sdp);
          toHost.send({
            kind: 'answer',
            data: { type: 'answer', sdp: prependFingerprint(own, remoteFingerprint) },
          });
        } else if (message.kind === 'ice') {
          addCandidate(facingRemote, message.data);
        }
      })
      .catch(() => undefined);
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
    const remoteDescriptions: string[] = [];
    const fake = fakeDataChannel({
      offerSdp: 'a=fingerprint:sha-256 AA:AA',
      setRemoteDescription: (_sdp, type) => remoteDescriptions.push(type),
    });
    const [hostSig, remoteSig] = createInMemorySignalingPair();
    const transport = new WebRtcTransport({
      signaling: hostSig,
      secret: 'shared-secret-256bit-base64url-answers',
      loadDataChannel: () => fake.module,
    });
    transport.attach(createStubSession());

    const answer = { type: 'answer', sdp: 'a=fingerprint:sha-256 BB:BB' };
    const answered = new Promise<void>((resolve) => {
      remoteSig.onSignal((message) => {
        if (message.kind !== 'offer') return;
        remoteSig.send({ kind: 'answer', data: answer });
        remoteSig.send({ kind: 'answer', data: answer });
        setTimeout(resolve, 200);
      });
    });
    await transport.start();
    await answered;

    expect(remoteDescriptions).toEqual(['answer']);
    await transport.stop();
  }, 15000);
});
