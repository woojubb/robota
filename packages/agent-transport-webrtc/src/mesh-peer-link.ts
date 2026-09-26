/**
 * One WebRTC connection between two of one user's devices, in either role, admitted by the device
 * handshake.
 *
 * The handshake is bound to the negotiated channel on both roles the same way: the remote fingerprint
 * is read from the certificate the DTLS layer verified, never from SDP text, and the remote
 * description must advertise exactly one fingerprint and only one is taken per link, so the certificate
 * the DTLS layer checks and the value the binding names are one and the same.
 *
 * Until admission the channel carries only handshake frames. Anything that is not one — or anything
 * after the peer's proof but before this side's verdict, beyond a small bound — is held or refused,
 * never delivered, and every refusal closes the connection. Only an admitted link delivers messages.
 */
import {
  extractDtlsFingerprint,
  extractDtlsFingerprintAttribute,
} from '@robota-sdk/agent-remote-pairing';

import { whenRemoteCertificateVerified } from './negotiated-certificate.js';
import { MAX_MESH_MESSAGE_CHARS, decodeMeshMessageFrame } from './mesh-signal.js';

import type {
  IDeviceHandshakeController,
  IDeviceHandshakeResult,
} from '@robota-sdk/agent-remote-pairing';
import type { IRtcPeerDiagnostics, RtcChannel, RtcPeer } from './rtc-peer.js';

/** The offerer creates the data channel and the offer; the answerer answers it. */
export type TMeshLinkRole = 'offerer' | 'answerer';

/** Why a link ended. `closed` is an orderly close by either side after or before admission. */
export type TMeshLinkEnd =
  'closed' | 'signaling' | 'channel-binding' | 'handshake' | 'protocol' | 'timeout';

/** How far a link got before it ended. */
export type TMeshLinkStage =
  'signaling' | 'connecting' | 'awaiting-channel' | 'handshake' | 'confirming' | 'admitted';

/**
 * Why a link ended, with what the connection under it went through, so a refusal says more than
 * "closed". `cause` is the underlying error when there was one (e.g. the device handshake refusal).
 */
export class MeshLinkEndedError extends Error {
  readonly end: TMeshLinkEnd;
  readonly stage: TMeshLinkStage;
  readonly role: TMeshLinkRole;
  readonly peer?: IRtcPeerDiagnostics;
  /** Why the data channel closed, when it had. */
  readonly channelClose?: string;
  override readonly cause?: unknown;

  constructor(details: {
    readonly end: TMeshLinkEnd;
    readonly stage: TMeshLinkStage;
    readonly role: TMeshLinkRole;
    readonly detail?: string;
    readonly peer?: IRtcPeerDiagnostics;
    readonly channelClose?: string;
    readonly cause?: unknown;
  }) {
    const parts = [`mesh link ended (${details.end}) during ${details.stage} as ${details.role}`];
    if (details.detail !== undefined) parts.push(details.detail);
    if (details.cause !== undefined) {
      parts.push(details.cause instanceof Error ? details.cause.message : String(details.cause));
    }
    const peer = details.peer;
    if (peer !== undefined) {
      parts.push(
        `connection ${peer.state} [${peer.history.join(' > ')}], ice ${peer.ice ?? '?'}, gathering ${
          peer.gathering ?? '?'
        }, candidates ${peer.localCandidates} sent / ${peer.remoteCandidates} applied, closed by ${
          peer.closedBy ?? 'the peer or the network'
        }${peer.handlerError !== undefined ? ` (${peer.handlerError})` : ''}`,
      );
    }
    if (details.channelClose !== undefined) parts.push(`channel ${details.channelClose}`);
    super(parts.join('; '));
    this.name = 'MeshLinkEndedError';
    this.end = details.end;
    this.stage = details.stage;
    this.role = details.role;
    if (peer !== undefined) this.peer = peer;
    if (details.channelClose !== undefined) this.channelClose = details.channelClose;
    if (details.cause !== undefined) this.cause = details.cause;
  }
}

export type TMeshLinkSignal =
  | { readonly kind: 'offer' | 'answer'; readonly sdp: string }
  | {
      readonly kind: 'ice';
      readonly candidate: { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
    };

export interface IMeshHandshakeBinding {
  readonly localFingerprint: string;
  /** Of the certificate the DTLS layer verified. */
  readonly remoteFingerprint: string;
  readonly send: (frame: unknown) => void;
}

export interface IMeshPeerLinkOptions {
  readonly role: TMeshLinkRole;
  /** A new peer connection; each one has a DTLS certificate of its own. */
  readonly createPeer: () => RtcPeer;
  readonly sendSignal: (signal: TMeshLinkSignal) => void;
  /** Start this side of the device handshake over the bound channel. */
  readonly startHandshake: (binding: IMeshHandshakeBinding) => IDeviceHandshakeController;
  /** From creation to admission. */
  readonly connectTimeoutMs: number;
  readonly onAdmitted: (result: IDeviceHandshakeResult) => void;
  /**
   * Whether this side takes the peer the handshake admitted, checked before this side says so to the
   * peer (e.g. the device the pair's inbox belongs to). Refusing ends the link as a handshake refusal.
   */
  readonly accepts?: (result: IDeviceHandshakeResult) => boolean;
  /** Called once, whatever ended the link, with why. */
  readonly onEnded: (end: TMeshLinkEnd, error: MeshLinkEndedError) => void;
}

/** Frames held before the handshake exists, or between the peer's proof and this side's verdict. */
const MAX_HELD_FRAMES = 16;
/** ICE candidates per direction; a connection gathers a handful, and the relay supplies the peer's. */
const MAX_CANDIDATES = 64;
const DATA_CHANNEL_LABEL = 'robota-mesh';
/** Time for a channel close to leave before the connection under it is closed. */
const PEER_CLOSE_GRACE_MS = 250;

/**
 * `confirming`: this side admitted the peer and said so; the link is admitted once the peer says the
 * same, so a side the peer refused never believes it is connected.
 */
type TState = 'connecting' | 'confirming' | 'admitted' | 'ended';

/** Sent once this side's handshake admitted the peer; nothing else precedes a message. */
const ADMITTED_FRAME = JSON.stringify({ t: 'mesh-admitted' });

export class MeshPeerLink {
  private state: TState = 'connecting';
  private peer?: RtcPeer;
  private channel?: RtcChannel;
  private localFingerprint?: string;
  private remoteFingerprint?: string;
  private tookRemoteDescription = false;
  /** Local candidates wait for the description: they can be gathered before it is sent. */
  private sentDescription = false;
  private readonly localCandidates: Extract<TMeshLinkSignal, { kind: 'ice' }>[] = [];
  private remoteCandidates = 0;
  private handshake?: IDeviceHandshakeController;
  private fedProof = false;
  private readonly held: string[] = [];
  private readonly handlers = new Set<(body: string) => void>();
  private readonly endHandlers = new Set<(end: TMeshLinkEnd) => void>();
  private signalChain: Promise<void> = Promise.resolve();
  private stopAwaitingCertificate?: () => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  private admissionResult?: IDeviceHandshakeResult;

  public constructor(private readonly options: IMeshPeerLinkOptions) {
    this.timer = setTimeout(() => this.end('timeout'), options.connectTimeoutMs);
  }

  public get role(): TMeshLinkRole {
    return this.options.role;
  }

  public get admitted(): boolean {
    return this.state === 'admitted';
  }

  public get ended(): boolean {
    return this.isEnded();
  }

  /** A method, not a narrowed field read: the state changes across every `await`. */
  private isEnded(): boolean {
    return this.state === 'ended';
  }

  /** The admission, once admitted. */
  public get admission(): IDeviceHandshakeResult | undefined {
    return this.state === 'admitted' ? this.admissionResult : undefined;
  }

  /** Offerer: create the data channel and send the offer. */
  public async offer(): Promise<void> {
    if (this.options.role !== 'offerer' || this.peer !== undefined || this.isEnded()) return;
    try {
      const peer = this.createPeer();
      this.adoptChannel(peer.createDataChannel(DATA_CHANNEL_LABEL));
      const sdp = await peer.createOffer();
      if (this.isEnded()) return;
      this.localFingerprint = extractDtlsFingerprint(sdp);
      this.sendDescription({ kind: 'offer', sdp });
    } catch (error) {
      this.end('signaling', error);
    }
  }

  /** A remote description or ICE candidate from the peer, applied in arrival order. */
  public onSignal(signal: TMeshLinkSignal): void {
    if (this.isEnded()) return;
    this.signalChain = this.signalChain
      .then(() => this.applySignal(signal))
      .catch((error: unknown) => this.end('signaling', error));
  }

  private async applySignal(signal: TMeshLinkSignal): Promise<void> {
    if (this.isEnded()) return;
    if (signal.kind === 'ice') {
      // Candidates only after the one remote description; earlier ones have nothing to apply to.
      if (!this.tookRemoteDescription || !this.peer) return;
      if (++this.remoteCandidates > MAX_CANDIDATES) return;
      this.peer.addRemoteCandidate({
        candidate: signal.candidate.candidate,
        mid: signal.candidate.sdpMid ?? String(signal.candidate.sdpMLineIndex ?? 0),
      });
      return;
    }
    const expected = this.options.role === 'offerer' ? 'answer' : 'offer';
    // One remote description per link: the one fingerprint checked is the one the binding names.
    if (signal.kind !== expected || this.tookRemoteDescription) return;
    this.tookRemoteDescription = true;
    let algorithm: string;
    try {
      algorithm = extractDtlsFingerprintAttribute(signal.sdp).algorithm;
    } catch (error) {
      this.end('channel-binding', error);
      return;
    }
    if (this.options.role === 'offerer') {
      const peer = this.peer;
      if (!peer) return;
      peer.acceptAnswer(signal.sdp);
      this.awaitCertificate(peer, algorithm);
      return;
    }
    const peer = this.createPeer();
    peer.onDataChannel((channel) => {
      // One data channel per link; a second one is not ours to read.
      if (this.channel !== undefined) {
        channel.close();
        return;
      }
      this.adoptChannel(channel);
    });
    const sdp = await peer.acceptOffer(signal.sdp);
    if (this.isEnded()) return;
    this.localFingerprint = extractDtlsFingerprint(sdp);
    this.sendDescription({ kind: 'answer', sdp });
    this.awaitCertificate(peer, algorithm);
  }

  private createPeer(): RtcPeer {
    const peer = this.options.createPeer();
    this.peer = peer;
    peer.onLocalCandidate((candidate) => {
      if (this.isEnded()) return;
      const signal: Extract<TMeshLinkSignal, { kind: 'ice' }> = {
        kind: 'ice',
        candidate: { candidate: candidate.candidate, sdpMid: candidate.mid },
      };
      if (this.sentDescription) this.options.sendSignal(signal);
      else if (this.localCandidates.length < MAX_CANDIDATES) this.localCandidates.push(signal);
    });
    peer.onStateChange((state) => {
      if (state === 'failed' || state === 'closed')
        this.end('closed', undefined, `connection ${state}`);
    });
    return peer;
  }

  private sendDescription(signal: Extract<TMeshLinkSignal, { kind: 'offer' | 'answer' }>): void {
    this.options.sendSignal(signal);
    this.sentDescription = true;
    for (const candidate of this.localCandidates.splice(0)) this.options.sendSignal(candidate);
  }

  private awaitCertificate(peer: RtcPeer, algorithm: string): void {
    this.stopAwaitingCertificate = whenRemoteCertificateVerified(
      peer,
      algorithm,
      (fingerprint) => {
        if (this.isEnded()) return;
        this.remoteFingerprint = fingerprint;
        this.maybeStartHandshake();
      },
      (reason) => this.end('channel-binding', new Error(reason)),
    );
  }

  private adoptChannel(channel: RtcChannel): void {
    this.channel = channel;
    // Subscribe at once: the implementation does not buffer a frame that arrives before a listener.
    channel.onMessage((text) => this.inbound(text));
    channel.onStateChange((state) => {
      if (state === 'open') this.maybeStartHandshake();
      else if (state === 'closed') this.end('closed', undefined, 'data channel closed');
    });
    if (channel.readyState === 'open') this.maybeStartHandshake();
  }

  private maybeStartHandshake(): void {
    const channel = this.channel;
    if (this.state !== 'connecting' || this.handshake !== undefined || channel === undefined)
      return;
    if (this.localFingerprint === undefined || this.remoteFingerprint === undefined) return;
    if (channel.readyState !== 'open') return;
    let controller: IDeviceHandshakeController;
    try {
      controller = this.options.startHandshake({
        localFingerprint: this.localFingerprint,
        remoteFingerprint: this.remoteFingerprint,
        send: (frame) => this.write(JSON.stringify(frame)),
      });
    } catch (error) {
      this.end('handshake', error);
      return;
    }
    this.handshake = controller;
    controller.result.then(
      (result) => this.confirm(result),
      (error: unknown) => this.end('handshake', error),
    );
    const early = this.held.splice(0);
    for (const frame of early) this.feed(frame);
  }

  private inbound(text: string): void {
    if (this.isEnded()) return;
    if (this.state === 'admitted') {
      this.deliver(text);
      return;
    }
    if (this.state === 'confirming') {
      this.confirmed(text);
      return;
    }
    if (this.handshake === undefined) {
      this.hold(text);
      return;
    }
    this.feed(text);
  }

  private hold(text: string): void {
    if (this.held.length >= MAX_HELD_FRAMES) {
      this.end('protocol');
      return;
    }
    this.held.push(text);
  }

  /** Pre-admission: the peer's handshake frames go to the handshake; what follows its proof waits. */
  private feed(text: string): void {
    if (this.fedProof) {
      this.hold(text);
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      frame = text; // the handshake refuses it as malformed, and the link ends
    }
    if (
      typeof frame === 'object' &&
      frame !== null &&
      (frame as { t?: unknown }).t === 'dh-prove'
    ) {
      this.fedProof = true;
    }
    this.handshake?.onFrame(frame);
  }

  private confirm(result: IDeviceHandshakeResult): void {
    if (this.state !== 'connecting') return;
    if (this.options.accepts !== undefined && !this.options.accepts(result)) {
      this.end('handshake', new Error('the admitted device is not the one this link is for'));
      return;
    }
    this.state = 'confirming';
    this.admissionResult = result;
    this.write(ADMITTED_FRAME);
    const held = this.held.splice(0);
    for (const frame of held) this.inbound(frame);
  }

  /** The peer's first frame after its own verdict must say it admitted this side. */
  private confirmed(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      frame = undefined;
    }
    const result = this.admissionResult;
    if (
      result === undefined ||
      typeof frame !== 'object' ||
      frame === null ||
      (frame as { t?: unknown }).t !== 'mesh-admitted'
    ) {
      this.end('protocol');
      return;
    }
    clearTimeout(this.timer);
    this.state = 'admitted';
    this.options.onAdmitted(result);
  }

  private deliver(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      frame = undefined;
    }
    const message = decodeMeshMessageFrame(frame);
    if (message === undefined) {
      this.end('protocol');
      return;
    }
    for (const handler of this.handlers) handler(message.body);
  }

  private write(text: string): void {
    try {
      this.channel?.send(text);
    } catch (error) {
      this.end('closed', error);
    }
  }

  /** Send one message. Only an admitted link sends. */
  public send(body: string): void {
    if (this.state !== 'admitted') throw new Error('mesh link is not admitted');
    if (body.length > MAX_MESH_MESSAGE_CHARS) {
      throw new Error(`mesh message exceeds ${MAX_MESH_MESSAGE_CHARS} characters`);
    }
    this.write(JSON.stringify({ t: 'mesh-msg', body }));
  }

  /** Messages from the admitted peer. Returns an unsubscribe. */
  public onMessage(handler: (body: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Fires once when the link ends, for whatever reason. Returns an unsubscribe. */
  public onEnd(handler: (end: TMeshLinkEnd) => void): () => void {
    this.endHandlers.add(handler);
    return () => this.endHandlers.delete(handler);
  }

  public close(): void {
    this.end('closed', undefined, 'closed by this side');
  }

  /** How far the link got. */
  public get stage(): TMeshLinkStage {
    if (this.state === 'admitted' || this.state === 'confirming') return this.state;
    if (this.handshake !== undefined) return 'handshake';
    if (this.remoteFingerprint !== undefined) return 'awaiting-channel';
    if (this.tookRemoteDescription) return 'connecting';
    return 'signaling';
  }

  private end(end: TMeshLinkEnd, cause?: unknown, detail?: string): void {
    if (this.isEnded()) return;
    // Read before anything below closes the channel and the connection.
    const error = new MeshLinkEndedError({
      end,
      stage: this.stage,
      role: this.options.role,
      ...(detail !== undefined ? { detail } : {}),
      ...(this.peer !== undefined ? { peer: this.peer.diagnostics() } : {}),
      ...(this.channel?.closeCause !== undefined ? { channelClose: this.channel.closeCause } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
    this.state = 'ended';
    clearTimeout(this.timer);
    this.stopAwaitingCertificate?.();
    this.held.length = 0;
    // A frame the handshake cannot decode settles it now, so its timer does not outlive the link.
    this.handshake?.onFrame(undefined);
    this.channel?.close();
    const peer = this.peer;
    // The channel's close goes out first, so the peer learns of it rather than waiting out a timeout.
    if (peer) setTimeout(() => peer.close(), PEER_CLOSE_GRACE_MS).unref?.();
    this.options.onEnded(end, error);
    for (const handler of this.endHandlers) handler(end);
    this.endHandlers.clear();
    this.handlers.clear();
  }
}
