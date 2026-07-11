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

import {
  deriveIdentityId,
  exportPublicKey,
  extractDtlsFingerprint,
  generateIdentityKeyPair,
} from '@robota-sdk/agent-remote-pairing';

import { ResponderGate, type IDeviceIdentityConfig } from './rtc-responder-gate.js';
import { createRtcSignalingClient, type ISignalingClient } from './rtc-signaling.js';

import type { IDeviceCredentialStore } from './device-credential-store.js';
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
  /** REMOTE-012 E3: browser credential store. When set, first-pair ENROLLS this device (pins the host key +
   *  advertises the device key) so a future reconnect (E4) can skip re-pairing. Absent → REMOTE-009 behavior. */
  readonly deviceCredentials?: IDeviceCredentialStore;
  /** Injection seams (default to the real implementations) — for tests. */
  readonly createSignaling?: typeof createRtcSignalingClient;
  readonly createPeer?: (config?: RTCConfiguration) => RTCPeerConnection;
  readonly startHandshake?: typeof startPairingHandshake;
  readonly generateDeviceKeyPair?: () => Promise<CryptoKeyPair>;
}

/** Stable origin for the credential-store key (falls back to the raw url if it does not parse). */
function originOf(relayUrl: string): string {
  try {
    return new URL(relayUrl).origin;
  } catch {
    return relayUrl;
  }
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

  /**
   * REMOTE-012 E3: build the device-identity config for first-pair enrollment — a fresh device keypair whose
   * public key is advertised to the host, and an `onEnrollHost` that pins the host's key + persists the
   * credential (keyed by relay origin + host identity). Reconnect INITIATION (reusing a stored credential) is
   * E4; E3 only enrolls. Returns undefined when no credential store is configured (REMOTE-009 behavior).
   */
  async function buildDeviceIdentity(): Promise<IDeviceIdentityConfig | undefined> {
    const store = options.deviceCredentials;
    if (!store) return undefined;
    const deviceKeyPair = await (
      options.generateDeviceKeyPair ?? (() => generateIdentityKeyPair(false))
    )();
    const devicePublicSpki = await exportPublicKey(deviceKeyPair.publicKey);
    const relayOrigin = originOf(options.relayUrl);
    return {
      deviceKeyPair,
      deviceId: await deriveIdentityId(devicePublicSpki),
      devicePublicSpki,
      onEnrollHost: (hostPublicSpki: string) => {
        void (async (): Promise<void> => {
          const hostIdentityId = await deriveIdentityId(hostPublicSpki);
          await store.save(relayOrigin, hostIdentityId, { deviceKeyPair, hostPublicSpki });
        })();
      },
    };
  }

  function makeGate(
    channel: RTCDataChannel,
    deviceIdentity?: IDeviceIdentityConfig,
  ): ResponderGate {
    return new ResponderGate({
      channel: { send: (d) => channel.send(d), close: () => channel.close() },
      secret: options.secret,
      localFingerprint: localFingerprint as string,
      remoteFingerprint: remoteFingerprint as string,
      onMessage: callbacks.onMessage,
      onAccept: () => {
        setStatus('connected');
        gate?.send({ type: 'get-messages' }); // request full history on connect (mirrors the WS client)
      },
      onReject: fail,
      ...(deviceIdentity ? { deviceIdentity } : {}),
      ...(options.startHandshake ? { startHandshake: options.startHandshake } : {}),
    });
  }

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

    if (!options.deviceCredentials) {
      // REMOTE-009 path — synchronous, unchanged.
      gate = makeGate(channel);
      channel.onmessage = (event: MessageEvent): void => {
        const data = event.data;
        gate?.onInbound(typeof data === 'string' ? data : String(data));
      };
      return;
    }

    // E3 path — the device keypair is async, so buffer inbound frames until the gate exists (werift/native do
    // not buffer pre-subscription, and the enrollment build is a microtask or two).
    const buffered: string[] = [];
    channel.onmessage = (event: MessageEvent): void => {
      const data = typeof event.data === 'string' ? event.data : String(event.data);
      if (gate) gate.onInbound(data);
      else buffered.push(data);
    };
    void (async (): Promise<void> => {
      const deviceIdentity = await buildDeviceIdentity();
      gate = makeGate(channel, deviceIdentity);
      for (const data of buffered) gate.onInbound(data);
    })();
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
