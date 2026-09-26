/**
 * One WebRTC peer connection and its data channels, over `node-datachannel`.
 *
 * The native binding takes a single callback per event and aborts the process when a callback throws,
 * so every callback here is registered once, fans out to handlers, and never lets an exception reach
 * the binding: a throwing handler closes the connection instead. Negotiation is explicit (no automatic
 * offers or answers), so a connection produces exactly the descriptions its owner asks for, and no ICE
 * server is contacted unless one is configured.
 */
import {
  loadDataChannel,
  type IDataChannelModule,
  type INdcDataChannel,
  type INdcIceServer,
  type INdcPeerConnection,
} from './datachannel-loader.js';

import type { IIceServer } from './webrtc-transport-options.js';

export type TRtcPeerState =
  'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
export type TRtcChannelState = 'connecting' | 'open' | 'closed';

export interface IRtcCandidate {
  readonly candidate: string;
  readonly mid: string;
}

export interface IRtcPeerOptions {
  readonly iceServers?: readonly IIceServer[];
  /** Relay (TURN) candidates only. */
  readonly forceTurn?: boolean;
  /** Test seam: the `node-datachannel` module. */
  readonly loadDataChannel?: () => IDataChannelModule;
}

/** Remote candidates kept while the remote description is still on its way. */
const MAX_EARLY_CANDIDATES = 64;

const DEFAULT_PORTS: Readonly<Record<string, number>> = { stun: 3478, turn: 3478, turns: 5349 };

/** One configured ICE server in the binding's form. Throws on a url it cannot represent. */
export function toNativeIceServer(server: IIceServer): string | INdcIceServer {
  const match =
    /^(stuns?|turns?):([^:?]+|\[[^\]]+\])(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i.exec(
      server.urls,
    );
  if (!match) throw new Error(`unsupported ICE server url: ${server.urls}`);
  const scheme = match[1]!.toLowerCase();
  const hostname = match[2]!.replace(/^\[|\]$/g, '');
  const port = match[3] !== undefined ? Number(match[3]) : (DEFAULT_PORTS[scheme] ?? 3478);
  if (scheme === 'stun' || scheme === 'stuns') return `stun:${hostname}:${port}`;
  return {
    hostname,
    port,
    ...(server.username !== undefined ? { username: server.username } : {}),
    ...(server.credential !== undefined ? { password: server.credential } : {}),
    relayType:
      scheme === 'turns' ? 'TurnTls' : match[4]?.toLowerCase() === 'tcp' ? 'TurnTcp' : 'TurnUdp',
  };
}

function textOf(message: string | Buffer | ArrayBuffer): string {
  if (typeof message === 'string') return message;
  return Buffer.from(message as ArrayBuffer).toString('utf8');
}

export class RtcChannel {
  private stateValue: TRtcChannelState;
  private readonly messageHandlers = new Set<(text: string) => void>();
  private readonly stateHandlers = new Set<(state: TRtcChannelState) => void>();

  public constructor(
    private readonly native: INdcDataChannel,
    private readonly fault: () => void,
  ) {
    this.stateValue = native.isOpen() ? 'open' : 'connecting';
    native.onOpen(() => this.guard(() => this.setState('open')));
    native.onClosed(() => this.guard(() => this.setState('closed')));
    native.onError(() => this.guard(() => this.setState('closed')));
    native.onMessage((message) =>
      this.guard(() => {
        const text = textOf(message);
        for (const handler of this.messageHandlers) handler(text);
      }),
    );
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch {
      // A throwing handler must not reach the native binding; the connection is closed instead.
      this.fault();
    }
  }

  private setState(state: TRtcChannelState): void {
    if (this.stateValue === state || this.stateValue === 'closed') return;
    this.stateValue = state;
    for (const handler of this.stateHandlers) handler(state);
  }

  public get readyState(): TRtcChannelState {
    return this.stateValue;
  }

  public get bufferedAmount(): number {
    try {
      return this.native.bufferedAmount();
    } catch {
      return 0;
    }
  }

  /** Throws when the channel is not open or the message cannot be sent. */
  public send(text: string): void {
    if (this.stateValue !== 'open') throw new Error('data channel is not open');
    this.native.sendMessage(text);
  }

  public onMessage(handler: (text: string) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public onStateChange(handler: (state: TRtcChannelState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  public close(): void {
    if (this.stateValue === 'closed') return;
    try {
      this.native.close();
    } catch {
      /* already closing */
    }
    this.setState('closed');
  }
}

export class RtcPeer {
  private readonly native: INdcPeerConnection;
  private stateValue: TRtcPeerState = 'new';
  private readonly stateHandlers = new Set<(state: TRtcPeerState) => void>();
  private readonly candidateHandlers = new Set<(candidate: IRtcCandidate) => void>();
  private readonly channelHandlers = new Set<(channel: RtcChannel) => void>();
  private readonly descriptionWaiters: ((sdp: string) => void)[] = [];
  private hasRemoteDescription = false;
  /** Remote candidates that arrived before the remote description, applied right after it. */
  private readonly earlyCandidates: IRtcCandidate[] = [];
  private closed = false;

  public constructor(options: IRtcPeerOptions = {}) {
    const module = (options.loadDataChannel ?? loadDataChannel)();
    this.native = new module.PeerConnection('robota', {
      iceServers: (options.iceServers ?? []).map(toNativeIceServer),
      ...(options.forceTurn === true ? { iceTransportPolicy: 'relay' as const } : {}),
      disableAutoNegotiation: true,
    });
    this.native.onStateChange((state) =>
      this.guard(() => {
        if (state === this.stateValue || this.stateValue === 'closed') return;
        this.stateValue = state as TRtcPeerState;
        for (const handler of this.stateHandlers) handler(this.stateValue);
      }),
    );
    this.native.onLocalCandidate((candidate, mid) =>
      this.guard(() => {
        // The binding writes the SDP attribute form; the wire form has no `a=` prefix.
        const value = candidate.startsWith('a=') ? candidate.slice(2) : candidate;
        if (value.length === 0) return;
        for (const handler of this.candidateHandlers) handler({ candidate: value, mid });
      }),
    );
    this.native.onLocalDescription((sdp) =>
      this.guard(() => {
        for (const waiter of this.descriptionWaiters.splice(0)) waiter(sdp);
      }),
    );
    this.native.onDataChannel((native) =>
      this.guard(() => {
        const channel = new RtcChannel(native, () => this.close());
        for (const handler of this.channelHandlers) handler(channel);
      }),
    );
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch {
      // A throwing handler must not reach the native binding; the connection is closed instead.
      this.close();
    }
  }

  public get state(): TRtcPeerState {
    return this.stateValue;
  }

  public createDataChannel(label: string): RtcChannel {
    return new RtcChannel(this.native.createDataChannel(label), () => this.close());
  }

  private localDescription(type: 'offer' | 'answer'): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.descriptionWaiters.push(resolve);
      try {
        this.native.setLocalDescription(type);
      } catch (error) {
        const at = this.descriptionWaiters.indexOf(resolve);
        if (at >= 0) this.descriptionWaiters.splice(at, 1);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Create and apply the local offer; resolves with its SDP. */
  public createOffer(): Promise<string> {
    return this.localDescription('offer');
  }

  /** Apply the remote offer, then create and apply the answer; resolves with its SDP. */
  public async acceptOffer(sdp: string): Promise<string> {
    this.native.setRemoteDescription(sdp, 'offer');
    this.remoteDescriptionApplied();
    return this.localDescription('answer');
  }

  public acceptAnswer(sdp: string): void {
    this.native.setRemoteDescription(sdp, 'answer');
    this.remoteDescriptionApplied();
  }

  private remoteDescriptionApplied(): void {
    this.hasRemoteDescription = true;
    for (const candidate of this.earlyCandidates.splice(0)) this.addRemoteCandidate(candidate);
  }

  /**
   * Apply a remote candidate. One that arrives before the remote description waits for it (bounded);
   * one the binding refuses is dropped.
   */
  public addRemoteCandidate(candidate: IRtcCandidate): void {
    if (this.closed) return;
    if (!this.hasRemoteDescription) {
      if (this.earlyCandidates.length < MAX_EARLY_CANDIDATES) this.earlyCandidates.push(candidate);
      return;
    }
    try {
      this.native.addRemoteCandidate(candidate.candidate, candidate.mid);
    } catch {
      // allow-fallback: an unusable candidate is one path fewer, not a failure of the connection
    }
  }

  /**
   * The fingerprint of the certificate the DTLS layer accepted, once connected; `undefined` before.
   * The DTLS layer (OpenSSL) accepts a certificate only after verifying the peer's handshake signature
   * with it and matching it against the remote description's fingerprint.
   */
  public remoteFingerprint(): { readonly value: string; readonly algorithm: string } | undefined {
    if (this.stateValue !== 'connected') return undefined;
    try {
      const fingerprint = this.native.remoteFingerprint();
      return fingerprint.value.length > 0 ? fingerprint : undefined;
    } catch {
      return undefined;
    }
  }

  public onStateChange(handler: (state: TRtcPeerState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  public onLocalCandidate(handler: (candidate: IRtcCandidate) => void): () => void {
    this.candidateHandlers.add(handler);
    return () => this.candidateHandlers.delete(handler);
  }

  public onDataChannel(handler: (channel: RtcChannel) => void): () => void {
    this.channelHandlers.add(handler);
    return () => this.channelHandlers.delete(handler);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.native.close();
    } catch {
      /* already closed */
    }
    if (this.stateValue !== 'closed') {
      this.stateValue = 'closed';
      for (const handler of this.stateHandlers) handler('closed');
    }
  }
}
