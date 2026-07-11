/**
 * Content-blind signaling relay (REMOTE-002 Stage A; abuse-hardened in REMOTE-004 Stage B2).
 *
 * Two NAT'd WebRTC peers exchange SDP offers/answers + ICE candidates through this relay to establish a direct
 * P2P `RTCDataChannel`. The relay is a **dumb rendezvous**: it pairs at most two peers by an opaque rendezvous
 * id and forwards **only** `offer`/`answer`/`ice` frames verbatim between them. It NEVER inspects the `data`
 * payload, NEVER forwards a non-signaling frame, and holds **no session content** — only transient membership.
 *
 * B2 makes the relay **safe by default** at its own layer (not only when a host wires a hook): a per-source
 * token-bucket bounds join floods, rendezvous ids are **single-use** (a distinct third peer is refused for the
 * lifetime of the id, even after one of the original two leaves), a **half-open** rendezvous (one peer, no
 * counterpart) expires after a TTL, and the number of concurrent rendezvous is capped. All abuse controls take
 * injected dependencies (clock + scheduler + params) so they are exercised by the network-free fake-peer suite.
 */
import {
  TokenBucketLimiter,
  systemClock,
  systemScheduler,
  DEFAULT_MESSAGE_RATE,
  DEFAULT_RENDEZVOUS_TTL_MS,
  DEFAULT_MAX_RENDEZVOUS,
  type IClock,
  type IScheduler,
  type ITokenBucketConfig,
} from './rate-limiter.js';

/** The kinds of signaling frame the relay will forward. Anything else is rejected, never relayed. */
export type TSignalKind = 'offer' | 'answer' | 'ice';

const SIGNAL_KINDS: ReadonlySet<string> = new Set<TSignalKind>(['offer', 'answer', 'ice']);

/** At most two peers may share a rendezvous (the host and one remote). */
export const MAX_PEERS_PER_RENDEZVOUS = 2;

/** A connected peer, abstracted over the concrete transport (a `ws` socket in production, a fake in tests). */
export interface ISignalingPeer {
  /** Stable per-connection id (relay-assigned). */
  readonly id: string;
  /** Client remote address (IP), when known — the rate-limit key. */
  readonly remoteAddress?: string;
  /** Deliver a raw JSON frame to this peer. */
  send(raw: string): void;
  /** Force-close this peer's connection. */
  close(): void;
}

/** Inbound control/signal frames the relay accepts. `join` establishes the rendezvous; `signal` is relayed. */
export type TInboundFrame =
  | { readonly type: 'join'; readonly rendezvous: string }
  | { readonly type: 'signal'; readonly kind: TSignalKind; readonly data: unknown };

/** Context passed to the join seam (REMOTE-004 — widened from the Stage-A `(rendezvous, peerId)` form). */
export interface IJoinAttemptContext {
  readonly rendezvous: string;
  readonly peerId: string;
  readonly remoteAddress?: string;
}

/** Optional hooks. `onJoinAttempt` is a custom-auth seam layered ON TOP of the built-in rate limiter. */
export interface ISignalingRelayHooks {
  onJoinAttempt?(context: IJoinAttemptContext): boolean;
}

/** Relay construction options. Abuse controls default on with production-safe values. */
export interface ISignalingRelayOptions {
  readonly hooks?: ISignalingRelayHooks;
  /** Per-source join token-bucket (default: burst 5, refill 1/12s). */
  readonly rateLimit?: ITokenBucketConfig;
  /**
   * Per-connection **message rate** for the relayed `signal` path (REMOTE-011 E2; default
   * {@link DEFAULT_MESSAGE_RATE}). Bounds a `signal` flood from an already-joined peer — distinct from the
   * per-source `join` bucket (`rateLimit`). Keyed by peer id and evicted on `remove()`.
   */
  readonly messageRate?: ITokenBucketConfig;
  /** Half-open rendezvous TTL in ms (default 60s). */
  readonly rendezvousTtlMs?: number;
  /** Ceiling on concurrent (active) rendezvous (default 1024). */
  readonly maxRendezvous?: number;
  /** Injected time source (default `Date.now`). */
  readonly clock?: IClock;
  /** Injected timer scheduler (default `setTimeout`). */
  readonly scheduler?: IScheduler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Routes signaling frames between the (≤2) peers sharing a rendezvous id, with built-in abuse hardening.
 */
export class SignalingRelay {
  private readonly rooms = new Map<string, Set<ISignalingPeer>>();
  private readonly peerRendezvous = new Map<string, string>();
  /** Distinct peer ids EVER admitted to a rendezvous — enforces single-use (id not reusable by a new peer). */
  private readonly lifetimePeers = new Map<string, Set<string>>();
  /** One pending timer per rendezvous (half-open expiry or post-empty lifetime GC). */
  private readonly timers = new Map<string, () => void>();

  private readonly hooks: ISignalingRelayHooks;
  private readonly limiter: TokenBucketLimiter;
  /** Per-connection message-rate bucket for the `signal` path (keyed by peer id; evicted on remove). */
  private readonly messageLimiter: TokenBucketLimiter;
  private readonly scheduler: IScheduler;
  private readonly ttlMs: number;
  private readonly maxRendezvous: number;

  public constructor(options: ISignalingRelayOptions = {}) {
    this.hooks = options.hooks ?? {};
    this.scheduler = options.scheduler ?? systemScheduler;
    this.ttlMs = options.rendezvousTtlMs ?? DEFAULT_RENDEZVOUS_TTL_MS;
    this.maxRendezvous = options.maxRendezvous ?? DEFAULT_MAX_RENDEZVOUS;
    const clock = options.clock ?? systemClock;
    this.limiter = new TokenBucketLimiter(options.rateLimit, clock);
    this.messageLimiter = new TokenBucketLimiter(
      options.messageRate ?? DEFAULT_MESSAGE_RATE,
      clock,
    );
  }

  /** Handle one raw inbound frame from `peer`. Only `signal` frames are ever forwarded, and only to the peer's counterpart. */
  public handleFrame(peer: ISignalingPeer, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.reject(peer, 'invalid-json');
      return;
    }
    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      this.reject(peer, 'malformed-frame');
      return;
    }

    if (parsed.type === 'join' && typeof parsed.rendezvous === 'string') {
      this.join(peer, parsed.rendezvous);
      return;
    }
    if (
      parsed.type === 'signal' &&
      typeof parsed.kind === 'string' &&
      SIGNAL_KINDS.has(parsed.kind)
    ) {
      this.relay(peer, parsed.kind as TSignalKind, parsed.data);
      return;
    }
    // Any other frame — including a `signal` with an unknown kind or a payload masquerading as session
    // content — is rejected and NEVER forwarded to the counterpart.
    this.reject(peer, 'unsupported-frame');
  }

  private join(peer: ISignalingPeer, rendezvous: string): void {
    // Rate-limit first (before any state is touched) — key by source IP, falling back to the peer id.
    if (!this.limiter.tryConsume(peer.remoteAddress ?? peer.id)) {
      this.reject(peer, 'rate-limited');
      return;
    }
    if (rendezvous.length === 0) {
      this.reject(peer, 'empty-rendezvous');
      return;
    }
    if (
      this.hooks.onJoinAttempt &&
      !this.hooks.onJoinAttempt({ rendezvous, peerId: peer.id, remoteAddress: peer.remoteAddress })
    ) {
      this.reject(peer, 'join-rejected');
      return;
    }

    const lifetime = this.lifetimePeers.get(rendezvous);
    const alreadyAdmitted = lifetime?.has(peer.id) ?? false;
    if (!alreadyAdmitted) {
      // Single-use: a NEW distinct peer beyond the two that ever held this id is refused (even after a leave).
      if (lifetime && lifetime.size >= MAX_PEERS_PER_RENDEZVOUS) {
        this.reject(peer, 'rendezvous-full');
        return;
      }
      // Concurrency cap: only when creating a brand-new rendezvous (unknown to both rooms + lifetime).
      const isNew = !this.rooms.has(rendezvous) && !this.lifetimePeers.has(rendezvous);
      if (isNew && this.rooms.size >= this.maxRendezvous) {
        this.reject(peer, 'too-many-rendezvous');
        return;
      }
    }

    // Re-joining a different rendezvous moves the peer; drop it from any prior room first (no cross-room leak).
    const prior = this.peerRendezvous.get(peer.id);
    if (prior && prior !== rendezvous) this.leaveRoom(peer, prior);

    let room = this.rooms.get(rendezvous);
    if (!room) {
      room = new Set<ISignalingPeer>();
      this.rooms.set(rendezvous, room);
    }
    let admitted = this.lifetimePeers.get(rendezvous);
    if (!admitted) {
      admitted = new Set<string>();
      this.lifetimePeers.set(rendezvous, admitted);
    }
    room.add(peer);
    admitted.add(peer.id);
    this.peerRendezvous.set(peer.id, rendezvous);
    peer.send(JSON.stringify({ type: 'joined', rendezvous }));
    this.armTimer(rendezvous);
    if (prior && prior !== rendezvous) this.armTimer(prior);
  }

  private relay(peer: ISignalingPeer, kind: TSignalKind, data: unknown): void {
    const rendezvous = this.peerRendezvous.get(peer.id);
    if (!rendezvous) {
      this.reject(peer, 'not-joined');
      return;
    }
    // Per-connection message-rate bound (REMOTE-011 E2): a joined peer flooding `signal` frames is
    // throttled here — the frame is dropped (never forwarded) rather than closing the connection.
    if (!this.messageLimiter.tryConsume(peer.id)) {
      this.reject(peer, 'message-rate-limited');
      return;
    }
    const room = this.rooms.get(rendezvous);
    if (!room) return;
    // Forward the opaque signal verbatim to the counterpart(s) only — never echo back to the sender.
    const frame = JSON.stringify({ type: 'signal', kind, data });
    for (const other of room) {
      if (other !== peer) other.send(frame);
    }
  }

  private reject(peer: ISignalingPeer, reason: string): void {
    peer.send(JSON.stringify({ type: 'error', reason }));
  }

  /** Drop a peer from its rendezvous (on disconnect). */
  public remove(peer: ISignalingPeer): void {
    const rendezvous = this.peerRendezvous.get(peer.id);
    this.peerRendezvous.delete(peer.id);
    // Evict the per-connection message bucket (REMOTE-011 E2) so the map is bounded by LIVE connections,
    // not by every peer id ever admitted — the unbounded-growth class this stage exists to close.
    this.messageLimiter.evict(peer.id);
    if (rendezvous) {
      this.leaveRoom(peer, rendezvous);
      this.armTimer(rendezvous);
    }
  }

  private leaveRoom(peer: ISignalingPeer, rendezvous: string): void {
    const room = this.rooms.get(rendezvous);
    if (!room) return;
    room.delete(peer);
    if (room.size === 0) this.rooms.delete(rendezvous);
  }

  /**
   * (Re)arm the single pending timer for a rendezvous based on its current occupancy:
   * - 1 peer  → half-open expiry after `ttlMs` (kick the lone peer, forget the id);
   * - 0 peers → lifetime-GC after `ttlMs` (bound memory; the id may be reused only after the window);
   * - 2 peers → no timer (cancel any pending).
   */
  private armTimer(rendezvous: string): void {
    this.clearTimer(rendezvous);
    const size = this.rooms.get(rendezvous)?.size ?? 0;
    if (size === 1) {
      this.timers.set(
        rendezvous,
        this.scheduler.schedule(() => this.expireHalfOpen(rendezvous), this.ttlMs),
      );
    } else if (size === 0 && this.lifetimePeers.has(rendezvous)) {
      this.timers.set(
        rendezvous,
        this.scheduler.schedule(() => this.gcLifetime(rendezvous), this.ttlMs),
      );
    }
  }

  private expireHalfOpen(rendezvous: string): void {
    this.timers.delete(rendezvous);
    const room = this.rooms.get(rendezvous);
    if (room && room.size === 1) {
      for (const lone of room) {
        this.peerRendezvous.delete(lone.id);
        lone.close();
      }
      this.rooms.delete(rendezvous);
    }
    this.gcLifetime(rendezvous);
  }

  private gcLifetime(rendezvous: string): void {
    this.lifetimePeers.delete(rendezvous);
    this.clearTimer(rendezvous);
  }

  private clearTimer(rendezvous: string): void {
    const cancel = this.timers.get(rendezvous);
    if (cancel) {
      cancel();
      this.timers.delete(rendezvous);
    }
  }

  /** Diagnostics only: current (active) rendezvous count (holds no session content). */
  public get rendezvousCount(): number {
    return this.rooms.size;
  }

  /** Diagnostics only (REMOTE-011 E2): live per-connection message-bucket count — asserts the memory bound. */
  public get messageBucketCount(): number {
    return this.messageLimiter.size;
  }
}
