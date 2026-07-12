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
  deriveReconnectRendezvous,
  deriveReconnectSeed,
  exportPublicKey,
  extractDtlsFingerprint,
  generateIdentityKeyPair,
  importPublicKey,
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
  /** REMOTE-013 E4: per-room wait during a reconnect probe (default 4s); tests inject a small value. */
  readonly reconnectRoomWaitMs?: number;
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

  // REMOTE-013 E4 resume state.
  let lastSeq = 0; // highest applied server seq — sent as `resume{lastSeq}` on reconnect
  let everConnected = false; // a drop is only reconnectable after a first successful connect
  let reconnecting = false;
  let reconnectAttempts = 0;
  let reconnectCtx: {
    relayOrigin: string;
    hostIdentityId: string;
    seed: string;
    deviceKeyPair: CryptoKeyPair;
    deviceId: string;
    pinnedHostPublicKey: CryptoKey;
  } | null = null;
  const ACK_EVERY = 16; // ack roughly every N applied messages (frees the host buffer)
  const MAX_RECONNECT_ATTEMPTS = 8; // bounded backoff ceiling → surface `failed`
  /** When set, `wireDataChannel` builds a RECONNECT-mode gate (E3 device reconnect) instead of first-pair. */
  let activeReconnectIdentity: IDeviceIdentityConfig | null = null;
  /** The counter of the room the current reconnect attempt is using (for resync-on-success). */
  let activeReconnectCounter = 0;

  /**
   * REMOTE-013 E4: intercept server messages to (i) drop duplicates by `seq` (idempotent apply on resume),
   * (ii) advance `lastSeq` + periodically `ack`, and (iii) turn a `resume_gap` into a full `get-messages` refresh.
   */
  const onServerMessage = (msg: TServerMessage & { seq?: number }): void => {
    if (msg.type === 'resume_gap') {
      lastSeq = 0;
      gate?.send({ type: 'get-messages' });
      return;
    }
    if (typeof msg.seq === 'number') {
      if (msg.seq <= lastSeq) return; // already applied → drop (dedup)
      lastSeq = msg.seq;
      if (lastSeq % ACK_EVERY === 0) gate?.send({ type: 'ack', seq: lastSeq });
    }
    callbacks.onMessage(msg);
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
      onEnrollHost: (hostPublicSpki: string, sessionKey?: string) => {
        void (async (): Promise<void> => {
          const hostIdentityId = await deriveIdentityId(hostPublicSpki);
          // REMOTE-013 E4: derive + persist the reconnect seed (from the pairing sessionKey) + counter 0, so a
          // future drop can rediscover the host at the rotating rendezvous and resume without re-pairing.
          const reconnectSeed = sessionKey ? await deriveReconnectSeed(sessionKey) : undefined;
          await store.save(relayOrigin, hostIdentityId, {
            deviceKeyPair,
            hostPublicSpki,
            ...(reconnectSeed ? { reconnectSeed, reconnectCounter: 0 } : {}),
          });
          // Capture what a WARM reconnect (same page session) needs to rediscover + re-authenticate the host.
          if (reconnectSeed) {
            reconnectCtx = {
              relayOrigin,
              hostIdentityId,
              seed: reconnectSeed,
              deviceKeyPair,
              deviceId: await deriveIdentityId(devicePublicSpki),
              pinnedHostPublicKey: await importPublicKey(hostPublicSpki),
            };
          }
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
      onMessage: onServerMessage,
      onAccept: () => {
        setStatus('connected');
        everConnected = true;
        reconnecting = false;
        reconnectAttempts = 0;
        // REMOTE-013 E4: on a RECONNECT, resume the tail after the last applied seq + advance the counter
        // (resync-on-success = used-room + 1); on a fresh connect, ask for full history (mirrors the WS client).
        if (deviceIdentity?.reconnect) {
          gate?.send({ type: 'resume', lastSeq });
          activeReconnectIdentity = null;
          void persistCounter(activeReconnectCounter + 1);
        } else {
          gate?.send({ type: 'get-messages' });
        }
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

    // REMOTE-013 E4 reconnect: the device identity is already captured (`activeReconnectIdentity`), so build the
    // gate synchronously in RECONNECT mode — on accept it verifies the host + sends `resume{lastSeq}`.
    if (activeReconnectIdentity) {
      gate = makeGate(channel, activeReconnectIdentity);
      channel.onmessage = (event: MessageEvent): void => {
        const data = event.data;
        gate?.onInbound(typeof data === 'string' ? data : String(data));
      };
      return;
    }

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

  /** Tear down the current peer + signaling (keeping the resume state) — used before a reconnect attempt. */
  function teardownPeer(): void {
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
  }

  /** REMOTE-013 E4: persist the advanced reconnect counter (resync-on-success). Best-effort. */
  async function persistCounter(counter: number): Promise<void> {
    const store = options.deviceCredentials;
    if (!store || !reconnectCtx) return;
    const cred = await store.get(reconnectCtx.relayOrigin, reconnectCtx.hostIdentityId);
    if (cred)
      await store.save(reconnectCtx.relayOrigin, reconnectCtx.hostIdentityId, {
        ...cred,
        reconnectCounter: counter,
      });
  }

  /** Open a peer + signaling at `rendezvous`. A drop after a successful connect triggers the reconnect loop. */
  function connectAt(rendezvous: string): void {
    setStatus(reconnecting ? 'pairing' : 'connecting');
    const createPeer = options.createPeer ?? ((c) => new RTCPeerConnection(c));
    const peerConfig: RTCConfiguration = {};
    if (options.iceServers) peerConfig.iceServers = options.iceServers;
    if (options.forceTurn) peerConfig.iceTransportPolicy = 'relay'; // browser equivalent of werift forceTurn
    const p = createPeer(Object.keys(peerConfig).length > 0 ? peerConfig : undefined);
    peer = p;
    p.onicecandidate = (event): void => {
      if (event.candidate) signaling?.send({ kind: 'ice', data: event.candidate.toJSON() });
    };
    p.ondatachannel = (event): void => wireDataChannel(event.channel);
    // A connection drop AFTER a first successful connect, with a stored credential, self-heals via reconnect.
    p.onconnectionstatechange = (): void => {
      const s = p.connectionState;
      if (
        (s === 'failed' || s === 'disconnected' || s === 'closed') &&
        everConnected &&
        reconnectCtx &&
        !reconnecting
      ) {
        void startReconnect();
      }
    };

    signaling = (options.createSignaling ?? createRtcSignalingClient)({
      url: options.relayUrl,
      rendezvous,
      onError: reconnecting ? () => undefined : fail, // during reconnect, a room miss is not fatal (loop retries)
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
        .catch(() => (reconnecting ? undefined : fail()));
    });
  }

  /**
   * REMOTE-013 E4 warm reconnect loop: on a drop, probe `rendezvous(counter)` then `rendezvous(counter+1)`
   * (the 2-room window), reconnecting via the E3 device reconnect and resuming. Bounded attempts → `failed`.
   */
  async function startReconnect(): Promise<void> {
    if (!reconnectCtx || reconnecting) return;
    reconnecting = true;
    while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && reconnecting) {
      reconnectAttempts += 1;
      const cred = await options.deviceCredentials?.get(
        reconnectCtx.relayOrigin,
        reconnectCtx.hostIdentityId,
      );
      const base = cred?.reconnectCounter ?? 0;
      for (const counter of [base, base + 1]) {
        if (!reconnecting) return; // a parallel attempt already succeeded (onAccept cleared it)
        activeReconnectCounter = counter;
        activeReconnectIdentity = {
          deviceKeyPair: reconnectCtx.deviceKeyPair,
          deviceId: reconnectCtx.deviceId,
          devicePublicSpki: '', // unused on reconnect (no enrollment)
          onEnrollHost: () => undefined,
          reconnect: {
            hostIdentityId: reconnectCtx.hostIdentityId,
            pinnedHostPublicKey: reconnectCtx.pinnedHostPublicKey,
          },
        };
        teardownPeer();
        connectAt(await deriveReconnectRendezvous(reconnectCtx.seed, counter));
        await new Promise((r) => setTimeout(r, options.reconnectRoomWaitMs ?? 4_000));
        if (!reconnecting) return; // onAccept set reconnecting=false → success
      }
    }
    // Exhausted the window without a resume → surface failure (the operator re-pairs via QR).
    reconnecting = false;
    activeReconnectIdentity = null;
    fail();
  }

  return {
    connect(): void {
      if (peer) return; // already connecting
      activeReconnectIdentity = null;
      connectAt(options.rendezvous);
    },
    disconnect(): void {
      reconnecting = false;
      activeReconnectIdentity = null;
      teardownPeer();
      setStatus('disconnected');
    },
    send(msg: TClientMessage): void {
      gate?.send(msg);
    },
    status: () => status,
  };
}
