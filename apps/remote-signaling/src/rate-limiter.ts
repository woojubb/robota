/**
 * Abuse-hardening primitives for the signaling relay (REMOTE-004 Stage B2).
 *
 * A per-source token-bucket bounds join attempts; a scheduler drives rendezvous TTL expiry. Both take injected
 * dependencies (an `IClock` for the bucket, an `IScheduler` for timers) so the relay's abuse controls are covered
 * by the same network-free, deterministic fake-peer unit suite as its routing logic — no real timers, no wall
 * clock, no sockets.
 */

/** Monotonic-enough time source (defaults to `Date.now`). */
export interface IClock {
  now(): number;
}

/** Deferred-callback scheduler (defaults to `setTimeout`/`clearTimeout`); tests inject a controllable fake. */
export interface IScheduler {
  /** Run `callback` after `delayMs`; returns a cancel function. */
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface ITokenBucketConfig {
  /** Maximum tokens (burst) per source. */
  readonly burst: number;
  /** Tokens refilled per millisecond (steady-state rate). */
  readonly refillPerMs: number;
}

/** Default: burst 5 joins, refill 1 token / 12s (~5/min steady) per source. */
export const DEFAULT_TOKEN_BUCKET: ITokenBucketConfig = { burst: 5, refillPerMs: 1 / 12_000 };

/**
 * Default per-connection **message rate** for the relayed `signal` path (REMOTE-011 E2): burst 60, refill
 * 1 token / 100ms (~10/s steady) — generous for a normal offer/answer + ICE-trickle negotiation, but bounds
 * a `signal` flood from an already-joined peer. Distinct from the per-source `join` bucket above.
 */
export const DEFAULT_MESSAGE_RATE: ITokenBucketConfig = { burst: 60, refillPerMs: 1 / 100 };

/** Default half-open rendezvous TTL (a rendezvous holding a single peer expires after this). */
export const DEFAULT_RENDEZVOUS_TTL_MS = 60_000;

/** Default ceiling on concurrent rendezvous. */
export const DEFAULT_MAX_RENDEZVOUS = 1024;

/** Default ceiling on total concurrent WebSocket connections (REMOTE-011 E2). ~2 peers × max rendezvous. */
export const DEFAULT_MAX_CONNECTIONS = 2048;

/** Default ceiling on concurrent connections per resolved source key (REMOTE-011 E2). `0` disables. */
export const DEFAULT_MAX_CONNECTIONS_PER_IP = 64;

/** Default max bytes per WebSocket frame (REMOTE-011 E2). Signaling frames are a few KB; far below ws's 100 MiB. */
export const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;

export const systemClock: IClock = { now: () => Date.now() };

export const systemScheduler: IScheduler = {
  schedule(callback: () => void, delayMs: number): () => void {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

/** Per-key token bucket. `tryConsume(key)` returns false when the key is over its rate. */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();

  public constructor(
    private readonly config: ITokenBucketConfig = DEFAULT_TOKEN_BUCKET,
    private readonly clock: IClock = systemClock,
  ) {}

  public tryConsume(key: string): boolean {
    const now = this.clock.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.burst, last: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = Math.max(0, now - bucket.last);
    bucket.tokens = Math.min(this.config.burst, bucket.tokens + elapsed * this.config.refillPerMs);
    bucket.last = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Drop a key's bucket (REMOTE-011 E2). Callers that key by a transient identity (e.g. a per-connection
   * peer id) MUST evict on teardown, else the map grows by every key ever seen — an unbounded leak.
   * Evicting an absent key is a harmless no-op.
   */
  public evict(key: string): void {
    this.buckets.delete(key);
  }

  /** Diagnostics only: number of live buckets (used to assert the eviction/memory bound in tests). */
  public get size(): number {
    return this.buckets.size;
  }
}
