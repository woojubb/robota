import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { extractDtlsFingerprint } from '@robota-sdk/agent-remote-pairing';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';
import type { RTCDataChannel, RTCPeerConnection } from 'werift';

import type { IPairingResult } from '@robota-sdk/agent-remote-pairing';

import { loadWerift } from './werift-loader.js';
import { PairingGate, type IHostReconnectConfig } from './pairing-gate.js';
import type { ISignalingClient } from './signaling.js';
import type { IWeriftModule } from './werift-loader.js';

/**
 * A single ICE (STUN/TURN) server for the HOST (werift) transport (REMOTE-010). `urls` is a SINGLE string with a
 * `turn:`/`turns:`/`stun:`/`stuns:` scheme — werift's ICE gatherer (`parseIceServers`) consumes only a single-string
 * url and silently drops array `urls`, so the host reader (`agent-cli` `parseIceServers`) must narrow to this shape
 * and reject what werift would drop (fail-closed). (The browser peer uses the native DOM `RTCIceServer`, which does
 * support array urls / `turns:` — a separate, wider validator.) Kept a plain interface (no DOM dependency here).
 */
export interface IIceServer {
  readonly urls: string;
  readonly username?: string;
  readonly credential?: string;
}

/** Construction options for {@link WebRtcTransport}. The signaling client is injected (Stage A: no settings). */
export interface IWebRtcTransportOptions {
  /** Signaling port used to exchange SDP/ICE with the remote peer by rendezvous id. */
  readonly signaling: ISignalingClient;
  /** Optional ICE servers (STUN/TURN). Omitted → host-candidate/loopback only. */
  readonly iceServers?: readonly IIceServer[];
  /**
   * REMOTE-004 defense-in-depth: when true, restrict ICE to **relay (TURN) candidates only**, so
   * host/server-reflexive candidates — and the local-interface gathering that touches the (unreachable, but
   * belt-and-braces) `ip` code path — are never used. Requires a TURN server in `iceServers`. Mapped to werift's
   * `iceTransportPolicy: 'relay'` (REMOTE-010) — werift IGNORES a top-level `forceTurn`, so it must NOT be passed.
   */
  readonly forceTurn?: boolean;
  /**
   * REMOTE-008 pairing secret. When set, the data channel is **pairing-gated**: it carries only pairing frames
   * until the directional-HMAC handshake accepts (channel-bound to the DTLS fingerprints), and only THEN is the
   * session exposed — fail closed on mismatch/timeout. When omitted (Stage-A loopback / tests), the channel is
   * exposed immediately with no pairing (unchanged behavior).
   */
  readonly secret?: string;
  /** REMOTE-008: fired when pairing accepts + the session is exposed (host lifecycle → status 'paired'). Carries the first-pair result (E4 uses its sessionKey). */
  readonly onPaired?: (result?: IPairingResult) => void;
  /** REMOTE-008: fired when pairing rejects/times out (host lifecycle → teardown; the channel is already closed). */
  readonly onPairingFailed?: () => void;
  /** REMOTE-012 E3: host reconnect/enrollment config. When set, the gate admits first-pair (with enrollment) OR a pinned-device reconnect. */
  readonly reconnect?: IHostReconnectConfig;
  /** Test seam: inject the werift module (defaults to the real lazy loader). */
  readonly loadWerift?: () => IWeriftModule;
}

/**
 * WebRTC P2P transport (REMOTE-001/002): carries an `IInteractiveSession` over an `RTCDataChannel` using the
 * SAME transport-neutral session bridge as the WebSocket transport (`createWsHandler` from
 * `@robota-sdk/agent-transport-protocol`). The host is the offerer: it creates the data channel + offer, and on
 * data-channel open wires the handler. **Stage A: `defaultEnabled: false`, no pairing/auth** — the signaling
 * client is injected and can be an in-memory loopback for tests.
 */
export class WebRtcTransport implements IConfigurableTransport<IInteractiveSession> {
  public readonly name = 'webrtc';
  public readonly defaultEnabled = false;
  public readonly optionsSchema = {} as const;

  private session?: IInteractiveSession;
  private peer?: RTCPeerConnection;
  private unsubscribeSignal?: () => void;
  private cleanupHandler?: () => void;
  /** REMOTE-008: local DTLS fingerprint (from the offer SDP), captured for the pairing channel-binding. */
  private localFingerprint?: string;
  /** REMOTE-008: the pairing gate for the current channel (only when `options.secret` is set). */
  private pairingGate?: PairingGate;

  public constructor(private readonly options: IWebRtcTransportOptions) {}

  public validateOptions(): boolean {
    return true;
  }

  public attach(session: IInteractiveSession): void {
    this.session = session;
  }

  public async start(): Promise<void> {
    const session = this.session;
    if (!session) throw new Error('WebRtcTransport: attach() must be called before start()');

    const { RTCPeerConnection } = (this.options.loadWerift ?? loadWerift)();
    const peerConfig: {
      iceServers?: { urls: string; username?: string; credential?: string }[];
      iceTransportPolicy?: 'all' | 'relay';
    } = {};
    if (this.options.iceServers)
      peerConfig.iceServers = this.options.iceServers.map((s) => ({ ...s }));
    // REMOTE-010: werift's ICE gatherer derives relay-only from `iceTransportPolicy === 'relay'` — it IGNORES a
    // top-level `forceTurn`. Map `forceTurn` → `iceTransportPolicy:'relay'`, else the privacy control is a silent
    // no-op and host/server-reflexive candidates still leak.
    if (this.options.forceTurn) peerConfig.iceTransportPolicy = 'relay';
    const peer = new RTCPeerConnection(Object.keys(peerConfig).length > 0 ? peerConfig : undefined);
    this.peer = peer;
    const signaling = this.options.signaling;

    peer.onIceCandidate.subscribe((candidate) => {
      if (candidate) signaling.send({ kind: 'ice', data: candidate.toJSON() });
    });

    // Serialize signal processing so `setRemoteDescription(answer)` always completes before any subsequent
    // `addIceCandidate` (werift does not buffer trickle candidates that arrive before the remote description).
    let signalChain: Promise<void> = Promise.resolve();
    this.unsubscribeSignal = signaling.onSignal((message) => {
      signalChain = signalChain.then(async () => {
        if (message.kind === 'answer') {
          await peer.setRemoteDescription(
            message.data as Parameters<typeof peer.setRemoteDescription>[0],
          );
          // REMOTE-008: the remote DTLS fingerprint is only knowable now (from the answer SDP). Start the
          // pairing handshake here — the data channel cannot open (DTLS) until the answer is processed, so no
          // inbound frame can arrive before the gate exists.
          this.startPairingIfConfigured(channel, session, message.data);
        } else if (message.kind === 'ice') {
          await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
        }
      });
    });

    const channel = peer.createDataChannel('robota-session');
    this.wireChannel(channel, session);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    // Capture the local DTLS fingerprint for the pairing channel-binding (offer SDP).
    if (this.options.secret && peer.localDescription) {
      this.localFingerprint = extractDtlsFingerprint(peer.localDescription.sdp);
    }
    signaling.send({ kind: 'offer', data: peer.localDescription });
  }

  /**
   * REMOTE-008: when a pairing secret is configured, build the {@link PairingGate} from the local + remote DTLS
   * fingerprints once the answer is in. The gate drives the handshake and only exposes the session on accept.
   */
  private startPairingIfConfigured(
    channel: RTCDataChannel,
    session: IInteractiveSession,
    answer: unknown,
  ): void {
    const secret = this.options.secret;
    if (!secret || !this.localFingerprint) return;
    const sdp = (answer as { sdp?: unknown }).sdp;
    if (typeof sdp !== 'string') return;
    this.pairingGate = new PairingGate({
      channel: { send: (d) => channel.send(d), close: () => void channel.close() },
      session,
      secret,
      role: 'initiator', // the host is the WebRTC offerer ≡ pairing initiator
      localFingerprint: this.localFingerprint,
      remoteFingerprint: extractDtlsFingerprint(sdp),
      ...(this.options.onPaired ? { onAccept: this.options.onPaired } : {}),
      ...(this.options.onPairingFailed ? { onReject: this.options.onPairingFailed } : {}),
      ...(this.options.reconnect ? { reconnect: this.options.reconnect } : {}),
    });
  }

  private wireChannel(channel: RTCDataChannel, session: IInteractiveSession): void {
    // Subscribe `onMessage` **eagerly at channel creation** — NOT inside the `open` event. werift does not buffer
    // inbound messages that arrive before a subscription exists, and the remote (answerer) can open its end and
    // send its first frame before the host's `open` fires, so a deferred subscription drops that first message.
    //
    // REMOTE-008: when a pairing secret is configured, the eager subscription is a ROUTING SWITCH — it forwards
    // to the {@link PairingGate}, which routes to the handshake pre-accept (dropping non-pairing frames) and to
    // the session bridge post-accept. The gate is created in the answer branch, so a frame arriving before it
    // exists is dropped (fail-closed) — but the channel cannot open until DTLS (post-answer), so that window is
    // empty in practice. Without a secret, behavior is unchanged: expose the session immediately.
    if (this.options.secret) {
      channel.onMessage.subscribe((data) => {
        this.pairingGate?.onInbound(typeof data === 'string' ? data : data.toString());
      });
      this.cleanupHandler = () => this.pairingGate?.cleanup();
      return;
    }

    // Unpaired (Stage-A loopback / tests): `channel.send` runs under try/catch because werift buffers sends while
    // the channel is `connecting` and only throws once `closing`/`closed` — the terminal case we drop, matching
    // WebSocket semantics where a send after close cannot carry the frame.
    const { onMessage, cleanup } = createWsHandler({
      session,
      send: (serverMessage) => {
        try {
          channel.send(JSON.stringify(serverMessage));
        } catch {
          // Channel is closing/closed — the peer is gone; the frame cannot be delivered.
        }
      },
    });
    this.cleanupHandler = cleanup;
    channel.onMessage.subscribe((data) => {
      onMessage(typeof data === 'string' ? data : data.toString());
    });
  }

  public async stop(): Promise<void> {
    this.cleanupHandler?.();
    this.unsubscribeSignal?.();
    this.cleanupHandler = undefined;
    this.unsubscribeSignal = undefined;
    this.pairingGate = undefined;
    this.localFingerprint = undefined;
    if (this.peer) {
      await this.peer.close();
      this.peer = undefined;
    }
  }
}
