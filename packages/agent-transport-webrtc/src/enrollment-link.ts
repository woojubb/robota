/**
 * The connection a device enrollment runs over: a new device dials the relay topic derived from its
 * enrollment code, an existing device listens there, and each gets a data channel bound to the DTLS
 * fingerprints of the connection — its own, and the one of the certificate the DTLS layer verified
 * for the peer, never SDP text.
 *
 * This file carries frames and implements no policy: what the channel says, and whether the peer is
 * believed, is the enrollment protocol's (`agent-remote-pairing`), which proves knowledge of the code
 * over these very fingerprints before anything else crosses. Until then a peer here is a stranger,
 * so the relay's signals are decoded as hostile input, a remote description must advertise exactly one
 * fingerprint, and a listener serves one attempt at a time.
 */
import {
  extractDtlsFingerprint,
  extractDtlsFingerprintAttribute,
} from '@robota-sdk/agent-remote-pairing';

import { whenRemoteCertificateVerified } from './negotiated-certificate.js';
import { RtcPeer, type RtcChannel } from './rtc-peer.js';

import type { IDataChannelModule } from './datachannel-loader.js';
import type { IMeshRelay } from './mesh-relay.js';
import type { IIceServer } from './webrtc-transport-options.js';

const SIGNAL_VERSION = 1;
const CHANNEL_LABEL = 'robota-enroll';
const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const MAX_CANDIDATES = 64;
/** Frames kept for a consumer that has not subscribed yet; an enrollment says a handful. */
const MAX_EARLY_FRAMES = 16;
/** Largest frame an enrollment channel carries: a grant holds a roster of certificates. */
const MAX_FRAME_CHARS = 256 * 1024;
const MAX_SDP_CHARS = 48 * 1024;
const MAX_CANDIDATE_CHARS = 2048;
const ATTEMPT_ID = /^[A-Za-z0-9_-]{22}$/;
/** Time for a channel close to leave before the connection under it is closed. */
const PEER_CLOSE_GRACE_MS = 250;

/** A data channel bound to one negotiated connection, carrying JSON frames. */
export interface IEnrollmentChannel {
  readonly localFingerprint: string;
  /** Of the certificate the DTLS layer verified. */
  readonly remoteFingerprint: string;
  /** Send one frame; a closed channel drops it (the peer learns of the close instead). */
  send(frame: unknown): void;
  /** Each inbound frame, JSON-decoded; text that is not JSON arrives as `undefined`. */
  onFrame(handler: (frame: unknown) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}

/**
 * Why no channel came about. `absent`: nobody waits at the topic — the code is wrong, expired or
 * already used.
 */
export type TEnrollmentLinkFailure =
  'absent' | 'timeout' | 'signaling' | 'channel-binding' | 'closed';

export class EnrollmentLinkError extends Error {
  readonly reason: TEnrollmentLinkFailure;

  constructor(reason: TEnrollmentLinkFailure, detail?: string) {
    super(`enrollment connection failed (${reason})${detail !== undefined ? `: ${detail}` : ''}`);
    this.name = 'EnrollmentLinkError';
    this.reason = reason;
  }
}

export interface IEnrollmentRendezvous {
  readonly relay: IMeshRelay;
  /** The topic this side waits at. */
  readonly inbound: string;
  /** The topic the other side waits at. */
  readonly outbound: string;
  readonly iceServers?: readonly IIceServer[];
  /** Test seam: inject the `node-datachannel` module. */
  readonly loadDataChannel?: () => IDataChannelModule;
  /** From the first signal of an attempt to a bound, open channel (default 20 s). */
  readonly connectTimeoutMs?: number;
}

type TSignal =
  | { readonly kind: 'offer' | 'answer'; readonly cid: string; readonly sdp: string }
  | {
      readonly kind: 'ice';
      readonly cid: string;
      readonly candidate: { readonly candidate: string; readonly mid: string };
    };

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function decodeSignal(value: unknown): TSignal | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  if (r['v'] !== SIGNAL_VERSION || typeof r['cid'] !== 'string' || !ATTEMPT_ID.test(r['cid'])) {
    return undefined;
  }
  const cid = r['cid'];
  if (r['kind'] === 'offer' || r['kind'] === 'answer') {
    return bounded(r['sdp'], MAX_SDP_CHARS) ? { kind: r['kind'], cid, sdp: r['sdp'] } : undefined;
  }
  if (r['kind'] === 'ice') {
    const c = r['candidate'];
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return undefined;
    const cr = c as Record<string, unknown>;
    if (!bounded(cr['candidate'], MAX_CANDIDATE_CHARS) || !bounded(cr['mid'], 64)) return undefined;
    return { kind: 'ice', cid, candidate: { candidate: cr['candidate'], mid: cr['mid'] } };
  }
  return undefined;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** One connection attempt, in either role, until its channel is bound and open. */
class EnrollmentAttempt {
  private peer?: RtcPeer;
  private channel?: RtcChannel;
  private localFingerprint?: string;
  private remoteFingerprint?: string;
  private tookRemoteDescription = false;
  private sentDescription = false;
  private readonly localCandidates: TSignal[] = [];
  private remoteCandidates = 0;
  private chain: Promise<void> = Promise.resolve();
  private stopAwaiting?: () => void;
  private readonly timer: ReturnType<typeof setTimeout>;
  private done = false;
  private readonly early: string[] = [];
  private readonly frameHandlers = new Set<(frame: unknown) => void>();
  private readonly closeHandlers = new Set<() => void>();

  public constructor(
    private readonly role: 'offerer' | 'answerer',
    public readonly cid: string,
    private readonly options: IEnrollmentRendezvous,
    private readonly onBound: (channel: IEnrollmentChannel) => void,
    private readonly onFailed: (error: EnrollmentLinkError) => void,
  ) {
    this.timer = setTimeout(
      () => this.fail(new EnrollmentLinkError('timeout')),
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    );
  }

  public async offer(): Promise<void> {
    try {
      const peer = this.createPeer();
      this.adopt(peer.createDataChannel(CHANNEL_LABEL));
      const sdp = await peer.createOffer();
      if (this.done) return;
      this.localFingerprint = extractDtlsFingerprint(sdp);
      this.sendDescription({ kind: 'offer', cid: this.cid, sdp });
    } catch (error) {
      this.fail(new EnrollmentLinkError('signaling', describe(error)));
    }
  }

  public onSignal(signal: TSignal): void {
    if (this.done) return;
    this.chain = this.chain
      .then(() => this.apply(signal))
      .catch((error: unknown) => this.fail(new EnrollmentLinkError('signaling', describe(error))));
  }

  private async apply(signal: TSignal): Promise<void> {
    if (this.done) return;
    if (signal.kind === 'ice') {
      if (this.peer === undefined || ++this.remoteCandidates > MAX_CANDIDATES) return;
      this.peer.addRemoteCandidate(signal.candidate);
      return;
    }
    const expected = this.role === 'offerer' ? 'answer' : 'offer';
    // One remote description: the one fingerprint checked is the one the binding names.
    if (signal.kind !== expected || this.tookRemoteDescription) return;
    this.tookRemoteDescription = true;
    let algorithm: string;
    try {
      algorithm = extractDtlsFingerprintAttribute(signal.sdp).algorithm;
    } catch (error) {
      this.fail(new EnrollmentLinkError('channel-binding', describe(error)));
      return;
    }
    if (this.role === 'offerer') {
      const peer = this.peer;
      if (peer === undefined) return;
      peer.acceptAnswer(signal.sdp);
      this.awaitCertificate(peer, algorithm);
      return;
    }
    const peer = this.createPeer();
    const sdp = await peer.acceptOffer(signal.sdp);
    if (this.done) return;
    this.localFingerprint = extractDtlsFingerprint(sdp);
    this.sendDescription({ kind: 'answer', cid: this.cid, sdp });
    this.awaitCertificate(peer, algorithm);
  }

  private createPeer(): RtcPeer {
    // A certificate of its own per connection, so no stable identifier crosses the relay.
    const peer = new RtcPeer({
      ...(this.options.iceServers !== undefined ? { iceServers: this.options.iceServers } : {}),
      ...(this.options.loadDataChannel !== undefined
        ? { loadDataChannel: this.options.loadDataChannel }
        : {}),
    });
    this.peer = peer;
    peer.onLocalCandidate((candidate) => {
      if (this.done) return;
      const signal: TSignal = {
        kind: 'ice',
        cid: this.cid,
        candidate: { candidate: candidate.candidate, mid: candidate.mid },
      };
      if (this.sentDescription) this.send(signal);
      else if (this.localCandidates.length < MAX_CANDIDATES) this.localCandidates.push(signal);
    });
    peer.onStateChange((state) => {
      if (state === 'failed' || state === 'closed') {
        this.fail(new EnrollmentLinkError('closed', `connection ${state}`));
      }
    });
    peer.onDataChannel((channel) => {
      if (this.role === 'answerer' && this.channel === undefined && !this.done) this.adopt(channel);
      else channel.close();
    });
    return peer;
  }

  private send(signal: TSignal): void {
    this.options.relay.send(this.options.outbound, { v: SIGNAL_VERSION, ...signal });
  }

  private sendDescription(signal: TSignal): void {
    this.send(signal);
    this.sentDescription = true;
    for (const candidate of this.localCandidates.splice(0)) this.send(candidate);
  }

  private awaitCertificate(peer: RtcPeer, algorithm: string): void {
    this.stopAwaiting = whenRemoteCertificateVerified(
      peer,
      algorithm,
      (fingerprint) => {
        this.remoteFingerprint = fingerprint;
        this.maybeBound();
      },
      (reason) => this.fail(new EnrollmentLinkError('channel-binding', reason)),
    );
  }

  private adopt(channel: RtcChannel): void {
    this.channel = channel;
    // Subscribed at once: the implementation does not keep a frame that arrives before a listener.
    channel.onMessage((text) => this.inbound(text));
    channel.onStateChange((state) => {
      if (state === 'open') this.maybeBound();
      else if (state === 'closed') this.closed();
    });
    if (channel.readyState === 'open') this.maybeBound();
  }

  private inbound(text: string): void {
    if (text.length > MAX_FRAME_CHARS) {
      this.closeAll();
      return;
    }
    if (this.frameHandlers.size === 0) {
      if (this.early.length >= MAX_EARLY_FRAMES) {
        this.closeAll();
        return;
      }
      this.early.push(text);
      return;
    }
    this.deliver(text);
  }

  private deliver(text: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      frame = undefined;
    }
    for (const handler of this.frameHandlers) handler(frame);
  }

  private maybeBound(): void {
    const channel = this.channel;
    if (this.done || channel === undefined || channel.readyState !== 'open') return;
    const localFingerprint = this.localFingerprint;
    const remoteFingerprint = this.remoteFingerprint;
    if (localFingerprint === undefined || remoteFingerprint === undefined) return;
    this.done = true;
    clearTimeout(this.timer);
    this.stopAwaiting?.();
    this.onBound({
      localFingerprint,
      remoteFingerprint,
      send: (frame) => {
        try {
          channel.send(JSON.stringify(frame));
        } catch {
          // allow-fallback: a closed channel drops the frame; its close reaches both sides
        }
      },
      onFrame: (handler) => {
        this.frameHandlers.add(handler);
        const held = this.early.splice(0);
        if (held.length > 0) queueMicrotask(() => held.forEach((text) => this.deliver(text)));
        return () => this.frameHandlers.delete(handler);
      },
      onClose: (handler) => {
        if (channel.readyState === 'closed') {
          queueMicrotask(handler);
          return () => undefined;
        }
        this.closeHandlers.add(handler);
        return () => this.closeHandlers.delete(handler);
      },
      close: () => this.closeAll(),
    });
  }

  private closed(): void {
    if (!this.done) {
      this.fail(new EnrollmentLinkError('closed', 'data channel closed'));
      return;
    }
    this.closeAll();
  }

  private closeAll(): void {
    this.channel?.close();
    const peer = this.peer;
    if (peer !== undefined) setTimeout(() => peer.close(), PEER_CLOSE_GRACE_MS).unref?.();
    const handlers = [...this.closeHandlers];
    this.closeHandlers.clear();
    this.frameHandlers.clear();
    for (const handler of handlers) handler();
  }

  public fail(error: EnrollmentLinkError): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    this.stopAwaiting?.();
    this.channel?.close();
    this.peer?.close();
    this.onFailed(error);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * New device: connect to whoever waits at `outbound`. Resolves with the bound channel; rejects when
 * nobody waits there (`absent`), on timeout, or when the connection fails. The relay stays the
 * caller's.
 */
export function dialEnrollment(options: IEnrollmentRendezvous): Promise<IEnrollmentChannel> {
  return new Promise<IEnrollmentChannel>((resolve, reject) => {
    const unsubscribes: (() => void)[] = [];
    const finish = (): void => {
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    };
    const attempt = new EnrollmentAttempt(
      'offerer',
      randomId(),
      options,
      (channel) => {
        finish();
        resolve(channel);
      },
      (error) => {
        finish();
        reject(error);
      },
    );
    unsubscribes.push(
      options.relay.onMessage((topic, data) => {
        if (topic !== options.inbound) return;
        const signal = decodeSignal(data);
        if (signal !== undefined && signal.cid === attempt.cid) attempt.onSignal(signal);
      }),
      options.relay.onAbsent((topic) => {
        if (topic === options.outbound) attempt.fail(new EnrollmentLinkError('absent'));
      }),
    );
    options.relay.declarePresence([options.inbound]);
    void attempt.offer();
  });
}

export interface IEnrollmentListener {
  /**
   * Stop taking new attempts. A channel already handed over stays open. The topic is held until the
   * caller closes the relay or declares other topics.
   */
  close(): void;
}

/**
 * Existing device: wait at `inbound` for a new device, one attempt at a time. Each bound channel goes
 * to `onChannel`; the next attempt is taken once that channel closes. The relay stays the caller's.
 */
export function listenForEnrollment(
  options: IEnrollmentRendezvous & {
    readonly onChannel: (channel: IEnrollmentChannel) => void;
    /** An attempt that ended before its channel was bound. */
    readonly onAttemptFailed?: (error: EnrollmentLinkError) => void;
  },
): IEnrollmentListener {
  let active: EnrollmentAttempt | undefined;
  let closed = false;
  const unsubscribe = options.relay.onMessage((topic, data) => {
    if (closed || topic !== options.inbound) return;
    const signal = decodeSignal(data);
    if (signal === undefined) return;
    if (active !== undefined) {
      if (signal.cid === active.cid) active.onSignal(signal);
      return;
    }
    if (signal.kind !== 'offer') return;
    const attempt: EnrollmentAttempt = new EnrollmentAttempt(
      'answerer',
      signal.cid,
      options,
      (channel) => {
        if (closed) {
          channel.close();
          return;
        }
        channel.onClose(() => {
          if (active === attempt) active = undefined;
        });
        options.onChannel(channel);
      },
      (error) => {
        if (active === attempt) active = undefined;
        options.onAttemptFailed?.(error);
      },
    );
    active = attempt;
    attempt.onSignal(signal);
  });
  options.relay.declarePresence([options.inbound]);
  return {
    close: () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      // An attempt still connecting is dropped; a bound channel is its consumer's.
      active?.fail(new EnrollmentLinkError('closed', 'no longer listening'));
    },
  };
}
