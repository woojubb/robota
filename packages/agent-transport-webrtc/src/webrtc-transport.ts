import { createWsHandler, resolveAdmission } from '@robota-sdk/agent-transport-protocol';
import { extractDtlsFingerprint } from '@robota-sdk/agent-remote-pairing';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';
import type { RTCDataChannel, RTCPeerConnection } from 'werift';

import type { IPairingResult } from '@robota-sdk/agent-remote-pairing';
import type { IProtocolSession, SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';

import { loadWerift } from './werift-loader.js';
import { PairingGate, type IHostReconnectConfig } from './pairing-gate.js';
import { createTransportLifecycleError } from './transport-lifecycle-error.js';
import { WebRtcDeliveryLifecycle } from './webrtc-delivery-lifecycle.js';
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
  /**
   * SEC-008: run with NO pairing gate. Requires `openReason`.
   *
   * Omitting `secret` used to mean this implicitly, which is how a remote peer reached the session
   * because a field was left unset. It is still a legitimate mode — loopback, tests — but it is now
   * a thing the host says rather than a thing that happens.
   */
  readonly open?: boolean;
  /** SEC-008: why running with no pairing gate is correct here. Required when `open` is true. */
  readonly openReason?: string;
  /** REMOTE-008: fired when pairing accepts + the session is exposed (host lifecycle → status 'paired'). Carries the first-pair result (E4 uses its sessionKey). */
  readonly onPaired?: (result?: IPairingResult) => void;
  /** REMOTE-008: fired when pairing rejects/times out (host lifecycle → teardown; the channel is already closed). */
  readonly onPairingFailed?: () => void;
  /** REMOTE-012 E3: host reconnect/enrollment config. When set, the gate admits first-pair (with enrollment) OR a pinned-device reconnect. */
  readonly reconnect?: IHostReconnectConfig;
  /** REMOTE-013 E4: a session-scoped resume bridge (owned by the controller across reconnects). Passed to the gate so the paired session flows through it (seq/buffer) and survives channel drops. */
  readonly resumeBridge?: SessionResumeBridge;
  /** REMOTE-013 E4: fired when a PAIRED data channel drops (so the controller can run the reconnect loop). Not fired for a pre-accept failure (that is `onPairingFailed`). */
  readonly onDropped?: () => void;
  /** Observe an outbound session-event delivery failure before the carrier drops. */
  readonly onDeliveryError?: (error: Error, event: string) => void;
  /** Test seam: inject the werift module (defaults to the real lazy loader). */
  readonly loadWerift?: () => IWeriftModule;
}

/**
 * WebRTC P2P transport (REMOTE-001/002): carries an `IProtocolSession` over an `RTCDataChannel` using the
 * SAME transport-neutral session bridge as the WebSocket transport (`createWsHandler` from
 * `@robota-sdk/agent-transport-protocol`). The host is the offerer: it creates the data channel + offer, and on
 * data-channel open wires the handler. **Stage A: `defaultEnabled: false`, no pairing/auth** — the signaling
 * client is injected and can be an in-memory loopback for tests.
 */
export class WebRtcTransport implements IConfigurableTransport<IInteractiveSession> {
  public readonly name = 'webrtc';
  public readonly lifecycle = Object.freeze({ kind: 'service' as const });
  public readonly defaultEnabled = false;
  public readonly optionsSchema = {} as const;

  private session?: IProtocolSession;
  private peer?: RTCPeerConnection;
  private unsubscribeSignal?: () => void;
  private cleanupHandler?: () => void;
  /** Invalidates pending async startup work and scopes pairing/drop state to one start generation. */
  private generation = 0;
  /** Local DTLS fingerprint captured for pairing channel binding. */
  private localFingerprint?: string;
  /** Pairing gate for the current channel. */
  private pairingGate?: PairingGate;
  private readonly deliveryLifecycle: WebRtcDeliveryLifecycle;

  public constructor(private readonly options: IWebRtcTransportOptions) {
    this.deliveryLifecycle = new WebRtcDeliveryLifecycle({
      cleanup: () => {
        this.cleanupHandler?.();
        this.pairingGate?.cleanup();
      },
      onDropped: () => this.options.onDropped?.(),
      onDeliveryError: (error, event) => this.options.onDeliveryError?.(error, event),
    });
    // A pairing secret and explicit open admission are contradictory, so fail before signaling.
    if (this.options.secret && this.options.open === true) {
      throw new Error(
        'WebRtcTransport: `secret` and `open: true` are contradictory. A pairing secret gates the ' +
          'data channel; `open` runs without a gate. Pass one.',
      );
    }
    if (this.options.secret === undefined || this.options.secret === '') {
      if (this.options.open !== true) {
        throw new Error(
          'WebRtcTransport: no pairing `secret` and no explicit `open`. Pass a `secret` to gate the ' +
            'data channel, or `{ open: true, openReason: "…" }` to run without pairing on purpose.',
        );
      }
      // WebRTC has no bearer credential; use the shared seam only to validate the open reason.
      void resolveAdmission({
        open: true,
        ...(this.options.openReason !== undefined ? { openReason: this.options.openReason } : {}),
      });
    }
  }

  public validateOptions(): boolean {
    return true;
  }

  public attach(session: IInteractiveSession): void;
  public attach(session: IProtocolSession): void;
  public attach(session: IProtocolSession): void {
    this.session = session;
  }
  private createPeer(): RTCPeerConnection {
    const { RTCPeerConnection } = (this.options.loadWerift ?? loadWerift)();
    const config: {
      iceServers?: { urls: string; username?: string; credential?: string }[];
      iceTransportPolicy?: 'all' | 'relay';
    } = {};
    if (this.options.iceServers)
      config.iceServers = this.options.iceServers.map((server) => ({ ...server }));
    if (this.options.forceTurn) config.iceTransportPolicy = 'relay';
    return new RTCPeerConnection(Object.keys(config).length > 0 ? config : undefined);
  }

  private wireSignaling(
    peer: RTCPeerConnection,
    channel: RTCDataChannel,
    session: IProtocolSession,
    generation: number,
  ): void {
    const signaling = this.options.signaling;
    peer.onIceCandidate.subscribe((candidate) => {
      if (candidate && generation === this.generation && peer === this.peer) {
        signaling.send({ kind: 'ice', data: candidate.toJSON() });
      }
    });
    let signalChain: Promise<void> = Promise.resolve();
    this.unsubscribeSignal = signaling.onSignal((message) => {
      if (generation !== this.generation) return;
      signalChain = signalChain.then(async () => {
        if (generation !== this.generation || peer !== this.peer) return;
        if (message.kind === 'answer') {
          await peer.setRemoteDescription(
            message.data as Parameters<typeof peer.setRemoteDescription>[0],
          );
          this.startPairingIfConfigured(channel, session, message.data, generation);
        } else if (message.kind === 'ice') {
          await peer.addIceCandidate(message.data as Parameters<typeof peer.addIceCandidate>[0]);
        }
      });
    });
  }

  private async requireCurrentPeer(peer: RTCPeerConnection, generation: number): Promise<void> {
    if (generation === this.generation && this.peer === peer) return;
    await peer.close();
    throw new Error('WebRtcTransport startup was stopped.');
  }

  public async start(): Promise<void> {
    const session = this.session;
    if (!session) throw createTransportLifecycleError('not-attached');
    if (this.peer) throw createTransportLifecycleError('already-started');
    const generation = ++this.generation;
    this.deliveryLifecycle.reset(generation);

    const peer = this.createPeer();
    this.peer = peer;
    const signaling = this.options.signaling;
    const channel = peer.createDataChannel('robota-session');
    this.wireChannel(channel, session, generation);
    this.wireSignaling(peer, channel, session, generation);

    const offer = await peer.createOffer();
    await this.requireCurrentPeer(peer, generation);
    await peer.setLocalDescription(offer);
    await this.requireCurrentPeer(peer, generation);
    // Capture the local DTLS fingerprint for the pairing channel-binding (offer SDP).
    if (this.options.secret && peer.localDescription) {
      this.localFingerprint = extractDtlsFingerprint(peer.localDescription.sdp);
    }
    signaling.send({ kind: 'offer', data: peer.localDescription });
  }

  /** Build the pairing gate only after the answer supplies the remote DTLS fingerprint. */
  private startPairingIfConfigured(
    channel: RTCDataChannel,
    session: IProtocolSession,
    answer: unknown,
    generation: number,
  ): void {
    if (generation !== this.generation) return;
    const secret = this.options.secret;
    if (!secret || !this.localFingerprint) return;
    const sdp = (answer as { sdp?: unknown }).sdp;
    if (typeof sdp !== 'string') return;
    this.pairingGate = new PairingGate({
      channel: { send: (d) => channel.send(d), close: () => void channel.close() },
      session,
      secret,
      role: 'initiator',
      localFingerprint: this.localFingerprint,
      remoteFingerprint: extractDtlsFingerprint(sdp),
      onAccept: (result) => {
        if (generation !== this.generation) return;
        this.deliveryLifecycle.accept(generation);
        this.options.onPaired?.(result);
      },
      ...(this.options.onPairingFailed ? { onReject: this.options.onPairingFailed } : {}),
      ...(this.options.reconnect ? { reconnect: this.options.reconnect } : {}),
      ...(this.options.resumeBridge ? { resumeBridge: this.options.resumeBridge } : {}),
      onDeliveryError: (error, event) =>
        this.deliveryLifecycle.handleFailure(channel, generation, error, event),
    });
  }

  private wireChannel(
    channel: RTCDataChannel,
    session: IProtocolSession,
    generation: number,
  ): void {
    // Subscribe eagerly: werift does not buffer a remote's first frame before a listener exists.
    // With a secret the gate drops pre-accept non-pairing frames; otherwise the session is exposed directly.
    if (this.options.secret) {
      channel.onMessage.subscribe((data) => {
        if (generation !== this.generation) return;
        this.pairingGate?.onInbound(typeof data === 'string' ? data : data.toString());
      });
      // A post-accept close detaches the resume bridge and starts reconnect without ending the session.
      channel.stateChanged.subscribe((state) => {
        if (generation !== this.generation) return;
        if (state === 'closed' || state === 'closing')
          this.deliveryLifecycle.handleDrop(generation);
      });
      this.cleanupHandler = () => this.pairingGate?.cleanup();
      return;
    }

    const { onMessage, cleanup } = createWsHandler({
      session,
      send: (serverMessage) => channel.send(JSON.stringify(serverMessage)),
      onDeliveryError: (error, event) =>
        this.deliveryLifecycle.handleFailure(channel, generation, error, event),
    });
    this.cleanupHandler = cleanup;
    channel.onMessage.subscribe((data) => {
      if (generation !== this.generation) return;
      onMessage(typeof data === 'string' ? data : data.toString());
    });
  }

  public async stop(): Promise<void> {
    this.generation += 1;
    this.cleanupHandler?.();
    this.unsubscribeSignal?.();
    this.cleanupHandler = undefined;
    this.unsubscribeSignal = undefined;
    this.pairingGate = undefined;
    this.localFingerprint = undefined;
    this.deliveryLifecycle.reset(this.generation);
    if (this.peer) {
      await this.peer.close();
      this.peer = undefined;
    }
    this.session = undefined;
  }
}
