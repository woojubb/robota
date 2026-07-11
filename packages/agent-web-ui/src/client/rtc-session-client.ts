/**
 * Browser data-channel session client (REMOTE-009 Stage D). The browser is the WebRTC ANSWERER: it joins the
 * relay by rendezvous, answers the host's offer over a native `RTCPeerConnection`, runs the pairing handshake
 * as RESPONDER over the data channel ({@link ResponderGate}), and — only after pairing accepts — exchanges
 * `TServerMessage`/`TClientMessage`s with the host session.
 *
 * It exposes the SAME `{ onMessage, onStatusChange, send }` contract as `createWsSessionClient`, so the existing
 * `useWsSession` reducer + `SessionMonitor` consume it unchanged — the single swap is WebSocket → data channel.
 * The channel-binding fingerprints come from the SDP: the HOST (remote) fp from the received offer, the LOCAL fp
 * from our own answer (`extractDtlsFingerprint`) — matching the Node responder oracle in
 * `agent-transport-webrtc/src/__tests__/pairing-e2e.test.ts`.
 */

import { extractDtlsFingerprint } from '@robota-sdk/agent-remote-pairing';

import { ResponderGate } from './rtc-responder-gate.js';
import { createRtcSignalingClient, type ISignalingClient } from './rtc-signaling.js';

import type { startPairingHandshake } from '@robota-sdk/agent-remote-pairing';
import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport-protocol';

/** Connection lifecycle for the RTC client (superset of the WS client's statuses: adds pairing/failed). */
export type TRtcConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | 'failed';

export interface IRtcSessionClientCallbacks {
  onMessage: (msg: TServerMessage) => void;
  onStatusChange: (status: TRtcConnectionStatus) => void;
}

export interface IRtcSessionClient {
  connect: () => void;
  disconnect: () => void;
  send: (msg: TClientMessage) => void;
  status: () => TRtcConnectionStatus;
}

export interface IRtcSessionClientOptions {
  /** Relay URL (from config / the page). */
  readonly relayUrl: string;
  /** Rendezvous id + high-entropy secret from the pairing URL fragment. */
  readonly rendezvous: string;
  readonly secret: string;
  /** Optional ICE servers (STUN/TURN) — REMOTE-010 supplies TURN; omitted → host candidates only. */
  readonly iceServers?: RTCIceServer[];
  /** REMOTE-010: restrict ICE to relay candidates (`iceTransportPolicy: 'relay'`); requires a TURN server. */
  readonly forceTurn?: boolean;
  /** Injection seams (default to the real implementations) — for tests. */
  readonly createSignaling?: typeof createRtcSignalingClient;
  readonly createPeer?: (config?: RTCConfiguration) => RTCPeerConnection;
  readonly startHandshake?: typeof startPairingHandshake;
}

export function createRtcSessionClient(
  options: IRtcSessionClientOptions,
  callbacks: IRtcSessionClientCallbacks,
): IRtcSessionClient {
  let signaling: ISignalingClient | null = null;
  let peer: RTCPeerConnection | null = null;
  let gate: ResponderGate | null = null;
  let localFingerprint: string | undefined;
  let remoteFingerprint: string | undefined;
  let status: TRtcConnectionStatus = 'disconnected';

  const setStatus = (s: TRtcConnectionStatus): void => {
    status = s;
    callbacks.onStatusChange(s);
  };

  const fail = (): void => {
    if (status !== 'failed') setStatus('failed');
  };

  function wireDataChannel(channel: RTCDataChannel): void {
    if (!remoteFingerprint || !localFingerprint) {
      // Fingerprints must be known before the channel opens (post-answer). If not, fail closed.
      fail();
      try {
        channel.close();
      } catch {
        /* noop */
      }
      return;
    }
    setStatus('pairing');
    gate = new ResponderGate({
      channel: { send: (d) => channel.send(d), close: () => channel.close() },
      secret: options.secret,
      localFingerprint,
      remoteFingerprint,
      onMessage: callbacks.onMessage,
      onAccept: () => {
        setStatus('connected');
        gate?.send({ type: 'get-messages' }); // request full history on connect (mirrors the WS client)
      },
      onReject: fail,
      ...(options.startHandshake ? { startHandshake: options.startHandshake } : {}),
    });
    channel.onmessage = (event: MessageEvent): void => {
      const data = event.data;
      gate?.onInbound(typeof data === 'string' ? data : String(data));
    };
  }

  async function handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!peer) return;
    remoteFingerprint = extractDtlsFingerprint(offer.sdp ?? '');
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    localFingerprint = extractDtlsFingerprint(peer.localDescription?.sdp ?? answer.sdp ?? '');
    signaling?.send({ kind: 'answer', data: peer.localDescription ?? answer });
  }

  return {
    connect(): void {
      if (peer) return; // already connecting
      setStatus('connecting');
      const createPeer = options.createPeer ?? ((c) => new RTCPeerConnection(c));
      const peerConfig: RTCConfiguration = {};
      if (options.iceServers) peerConfig.iceServers = options.iceServers;
      if (options.forceTurn) peerConfig.iceTransportPolicy = 'relay'; // browser equivalent of werift forceTurn
      peer = createPeer(Object.keys(peerConfig).length > 0 ? peerConfig : undefined);
      peer.onicecandidate = (event): void => {
        if (event.candidate) signaling?.send({ kind: 'ice', data: event.candidate.toJSON() });
      };
      peer.ondatachannel = (event): void => wireDataChannel(event.channel);

      signaling = (options.createSignaling ?? createRtcSignalingClient)({
        url: options.relayUrl,
        rendezvous: options.rendezvous,
        onError: fail,
      });
      let chain: Promise<void> = Promise.resolve();
      signaling.onSignal((message) => {
        chain = chain
          .then(async () => {
            if (message.kind === 'offer') {
              await handleOffer(message.data as RTCSessionDescriptionInit);
            } else if (message.kind === 'ice' && peer) {
              await peer.addIceCandidate(message.data as RTCIceCandidateInit);
            }
          })
          .catch(() => fail());
      });
    },
    disconnect(): void {
      gate?.close();
      gate = null;
      try {
        peer?.close();
      } catch {
        /* noop */
      }
      peer = null;
      signaling?.close();
      signaling = null;
      setStatus('disconnected');
    },
    send(msg: TClientMessage): void {
      gate?.send(msg);
    },
    status: () => status,
  };
}
