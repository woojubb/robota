import { createSessionMessageHandler } from '@robota-sdk/agent-transport';
import { resolveAdmission } from '@robota-sdk/agent-transport/node';
import {
  extractDtlsFingerprint,
  extractDtlsFingerprintAttribute,
} from '@robota-sdk/agent-remote-pairing';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';

import type { IProtocolSession } from '@robota-sdk/agent-transport';

import { createChannelDelivery } from './channel-delivery.js';
import { whenRemoteCertificateVerified } from './negotiated-certificate.js';
import { RtcPeer, type IRtcCandidate, type RtcChannel } from './rtc-peer.js';
import { PairingGate } from './pairing-gate.js';
import { createTransportLifecycleError } from './transport-lifecycle-error.js';
import { WebRtcDeliveryLifecycle } from './webrtc-delivery-lifecycle.js';
import type { IWebRtcTransportOptions } from './webrtc-transport-options.js';

/** Frames a peer may send before the gate exists; the pairing handshake needs only a few. */
const MAX_PENDING_FRAMES = 16;
/** Local ICE candidates held until the offer is out. */
const MAX_PENDING_CANDIDATES = 64;

/**
 * WebRTC P2P transport (REMOTE-001/002): carries an `IProtocolSession` over an `RTCDataChannel` using the
 * SAME transport-neutral session bridge as the WebSocket transport (`createSessionMessageHandler` from
 * `@robota-sdk/agent-transport`). The host is the offerer: it creates the data channel + offer and wires the
 * channel as soon as it is created. `defaultEnabled: false` — nothing starts it automatically. Admission is
 * fixed at construction: a pairing `secret` gates the session behind the pairing handshake, and running
 * without one requires `open: true` with an `openReason`. The signaling client is injected and can be an
 * in-memory loopback for tests.
 */
export class WebRtcTransport implements IConfigurableTransport<IProtocolSession> {
  public readonly name = 'webrtc';
  public readonly lifecycle = Object.freeze({ kind: 'service' as const });
  public readonly defaultEnabled = false;
  public readonly optionsSchema = {} as const;

  private session?: IProtocolSession;
  private peer?: RtcPeer;
  private unsubscribeSignal?: () => void;
  private cleanupHandler?: () => void;
  /** Invalidates pending async startup work and scopes pairing/drop state to one start generation. */
  private generation = 0;
  /** Local DTLS fingerprint captured for pairing channel binding. */
  private localFingerprint?: string;
  /** Pairing gate for the current channel. */
  private pairingGate?: PairingGate;
  /** Whether this start generation has sent its offer; local candidates wait for it. */
  private offerSent = false;
  private localCandidates: IRtcCandidate[] = [];
  /** Whether this start generation has taken its one answer; any later answer is ignored. */
  private answered = false;
  /** Pre-gate channel frames, replayed into the gate once it exists. Bounded. */
  private pendingFrames: string[] = [];
  private stopAwaitingCertificate?: () => void;
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

  public attach(session: IProtocolSession): void {
    this.session = session;
  }
  private createPeer(): RtcPeer {
    return new RtcPeer({
      ...(this.options.iceServers ? { iceServers: this.options.iceServers } : {}),
      ...(this.options.forceTurn ? { forceTurn: true } : {}),
      ...(this.options.loadDataChannel ? { loadDataChannel: this.options.loadDataChannel } : {}),
    });
  }

  private wireSignaling(
    peer: RtcPeer,
    channel: RtcChannel,
    session: IProtocolSession,
    generation: number,
  ): void {
    const signaling = this.options.signaling;
    peer.onLocalCandidate((candidate) => {
      if (generation !== this.generation || peer !== this.peer) return;
      // A candidate can be gathered before the offer is out; it follows the offer, never precedes it.
      if (this.offerSent) this.sendCandidate(candidate);
      else if (this.localCandidates.length < MAX_PENDING_CANDIDATES)
        this.localCandidates.push(candidate);
    });
    let signalChain: Promise<void> = Promise.resolve();
    this.unsubscribeSignal = signaling.onSignal((message) => {
      if (generation !== this.generation) return;
      signalChain = signalChain
        .then(async () => {
          if (generation !== this.generation || peer !== this.peer) return;
          if (message.kind === 'answer') {
            // One answer per start: the one fingerprint checked is the one the binding names.
            if (this.answered) return;
            this.answered = true;
            const algorithm = this.remoteFingerprintAlgorithm(channel, message.data);
            if (this.options.secret && algorithm === undefined) return;
            const sdp = (message.data as { sdp?: unknown } | null)?.sdp;
            if (typeof sdp !== 'string') return;
            peer.acceptAnswer(sdp);
            if (algorithm !== undefined)
              this.awaitVerifiedCertificate(peer, channel, session, algorithm, generation);
          } else if (message.kind === 'ice') {
            const candidate = toRemoteCandidate(message.data);
            if (candidate !== undefined) peer.addRemoteCandidate(candidate);
          }
        })
        .catch(() => {
          // A description the connection refuses ends this start, never with an unhandled rejection.
          if (generation === this.generation) this.failPairing(channel);
        });
    });
  }

  private sendCandidate(candidate: IRtcCandidate): void {
    this.options.signaling.send({
      kind: 'ice',
      data: { candidate: candidate.candidate, sdpMid: candidate.mid, sdpMLineIndex: 0 },
    });
  }

  private requireCurrentPeer(peer: RtcPeer, generation: number): void {
    if (generation === this.generation && this.peer === peer) return;
    peer.close();
    throw new Error('WebRtcTransport startup was stopped.');
  }

  public async start(): Promise<void> {
    const session = this.session;
    if (!session) throw createTransportLifecycleError('not-attached');
    if (this.peer) throw createTransportLifecycleError('already-started');
    const generation = ++this.generation;
    this.deliveryLifecycle.reset(generation);
    this.answered = false;
    this.offerSent = false;
    this.localCandidates = [];
    this.pendingFrames = [];

    const peer = this.createPeer();
    this.peer = peer;
    const signaling = this.options.signaling;
    const channel = peer.createDataChannel('robota-session');
    this.wireChannel(channel, session, generation);
    this.wireSignaling(peer, channel, session, generation);

    const sdp = await peer.createOffer();
    this.requireCurrentPeer(peer, generation);
    // Capture the local DTLS fingerprint for the pairing channel-binding (offer SDP).
    if (this.options.secret) this.localFingerprint = extractDtlsFingerprint(sdp);
    signaling.send({ kind: 'offer', data: { type: 'offer', sdp } });
    this.offerSent = true;
    for (const candidate of this.localCandidates.splice(0)) this.sendCandidate(candidate);
  }

  /**
   * With a pairing secret, the answer must advertise exactly one DTLS fingerprint; its algorithm is the one the
   * verified certificate is hashed with. A refused answer fails pairing and closes the channel.
   */
  private remoteFingerprintAlgorithm(channel: RtcChannel, answer: unknown): string | undefined {
    if (!this.options.secret) return undefined;
    const sdp = (answer as { sdp?: unknown }).sdp;
    try {
      if (typeof sdp !== 'string') throw new Error('answer carries no SDP');
      return extractDtlsFingerprintAttribute(sdp).algorithm;
    } catch {
      this.failPairing(channel);
      return undefined;
    }
  }

  private failPairing(channel: RtcChannel): void {
    channel.close();
    this.options.onPairingFailed?.();
  }

  /** Build the pairing gate once the DTLS layer has verified the remote certificate. */
  private awaitVerifiedCertificate(
    peer: RtcPeer,
    channel: RtcChannel,
    session: IProtocolSession,
    algorithm: string,
    generation: number,
  ): void {
    this.stopAwaitingCertificate = whenRemoteCertificateVerified(
      peer,
      algorithm,
      (remoteFingerprint) => {
        if (generation !== this.generation) return;
        // The gate speaks first, so it starts once the channel can carry its frame.
        if (channel.readyState === 'open') {
          this.startPairing(channel, session, remoteFingerprint, generation);
          return;
        }
        const unsubscribe = channel.onStateChange((state) => {
          if (state !== 'open' || generation !== this.generation) return;
          unsubscribe();
          this.startPairing(channel, session, remoteFingerprint, generation);
        });
      },
      () => {
        if (generation === this.generation) this.failPairing(channel);
      },
    );
  }

  private startPairing(
    channel: RtcChannel,
    session: IProtocolSession,
    remoteFingerprint: string,
    generation: number,
  ): void {
    const secret = this.options.secret;
    if (!secret || !this.localFingerprint) return;
    this.pairingGate = new PairingGate({
      channel: { send: (d) => channel.send(d), close: () => channel.close() },
      session,
      secret,
      role: 'initiator',
      localFingerprint: this.localFingerprint,
      remoteFingerprint,
      onAccept: (result) => {
        if (generation !== this.generation) return;
        this.deliveryLifecycle.accept(generation);
        this.options.onPaired?.(result);
      },
      ...(this.options.onPairingFailed ? { onReject: this.options.onPairingFailed } : {}),
      ...(this.options.reconnect ? { reconnect: this.options.reconnect } : {}),
      ...(this.options.localPeer ? { localPeer: this.options.localPeer } : {}),
      ...(this.options.connectionApproval
        ? { connectionApproval: this.options.connectionApproval }
        : {}),
      ...(this.options.resumeBridge ? { resumeBridge: this.options.resumeBridge } : {}),
      ...(this.options.personalUsageReporter
        ? { personalUsageReporter: this.options.personalUsageReporter }
        : {}),
      ...(this.options.usageReporter ? { usageReporter: this.options.usageReporter } : {}),
      ...(this.options.storedSessionUsageReporter
        ? { storedSessionUsageReporter: this.options.storedSessionUsageReporter }
        : {}),
      surface: 'remote',
      onDeliveryError: (error, event) =>
        this.deliveryLifecycle.handleFailure(channel, generation, error, event),
    });
    const gate = this.pairingGate;
    for (const frame of this.pendingFrames.splice(0)) gate.onInbound(frame);
  }

  private wireChannel(channel: RtcChannel, session: IProtocolSession, generation: number): void {
    // Subscribe eagerly: a remote's first frame is not buffered before a listener exists.
    // With a secret the gate keeps pre-accept non-pairing frames from the session; otherwise the session is exposed directly.
    if (this.options.secret) {
      channel.onMessage((frame) => {
        if (generation !== this.generation) return;
        if (this.pairingGate) this.pairingGate.onInbound(frame);
        else if (this.pendingFrames.length < MAX_PENDING_FRAMES) this.pendingFrames.push(frame);
      });
      // A post-accept close detaches the resume bridge and starts reconnect without ending the session.
      channel.onStateChange((state) => {
        if (generation !== this.generation) return;
        if (state === 'closed') {
          // Before acceptance the gate must hear it too: a question still open with the operator is
          // about a connection that no longer exists.
          this.pairingGate?.onChannelClosed();
          this.deliveryLifecycle.handleDrop(generation);
        }
      });
      this.cleanupHandler = () => this.pairingGate?.cleanup();
      return;
    }

    // ARCH-030: the transport is the carrier on the no-secret branch — its own sink, its own lifecycle.
    const { onMessage, cleanup } = createSessionMessageHandler({
      session,
      deliver: createChannelDelivery(channel, (error, event) =>
        this.deliveryLifecycle.handleFailure(channel, generation, error, event),
      ),
      ...(this.options.personalUsageReporter
        ? { personalUsageReporter: this.options.personalUsageReporter }
        : {}),
      ...(this.options.usageReporter ? { usageReporter: this.options.usageReporter } : {}),
      ...(this.options.storedSessionUsageReporter
        ? { storedSessionUsageReporter: this.options.storedSessionUsageReporter }
        : {}),
      surface: 'remote',
    });
    this.cleanupHandler = cleanup;
    channel.onMessage((frame) => {
      if (generation !== this.generation) return;
      onMessage(frame);
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
    this.answered = false;
    this.offerSent = false;
    this.localCandidates = [];
    this.pendingFrames = [];
    this.stopAwaitingCertificate?.();
    this.stopAwaitingCertificate = undefined;
    this.deliveryLifecycle.reset(this.generation);
    if (this.peer) {
      this.peer.close();
      this.peer = undefined;
    }
    this.session = undefined;
  }
}

/** A remote ICE candidate as a browser sends it (`RTCIceCandidateInit`), or `undefined` for none. */
function toRemoteCandidate(data: unknown): { candidate: string; mid: string } | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown };
  if (typeof record.candidate !== 'string' || record.candidate.length === 0) return undefined;
  const mid =
    typeof record.sdpMid === 'string'
      ? record.sdpMid
      : typeof record.sdpMLineIndex === 'number'
        ? String(record.sdpMLineIndex)
        : '0';
  return { candidate: record.candidate, mid };
}
