import { createWsHandler, resolveAdmission } from '@robota-sdk/agent-transport-protocol';
import { extractDtlsFingerprint } from '@robota-sdk/agent-remote-pairing';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { RTCDataChannel, RTCPeerConnection } from 'werift';

import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

import { createChannelDelivery } from './channel-delivery.js';
import { loadWerift } from './werift-loader.js';
import { PairingGate } from './pairing-gate.js';
import { createTransportLifecycleError } from './transport-lifecycle-error.js';
import { WebRtcDeliveryLifecycle } from './webrtc-delivery-lifecycle.js';
import type { IWebRtcTransportOptions } from './webrtc-transport-options.js';

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
      ...(this.options.localPeer ? { localPeer: this.options.localPeer } : {}),
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

    // ARCH-030: the transport is the carrier on the no-secret branch — its own sink, its own lifecycle.
    const { onMessage, cleanup } = createWsHandler({
      session,
      deliver: createChannelDelivery(channel, (error, event) =>
        this.deliveryLifecycle.handleFailure(channel, generation, error, event),
      ),
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
