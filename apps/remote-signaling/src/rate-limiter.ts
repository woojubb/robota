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

/** Default half-open rendezvous TTL (a rendezvous holding a single peer expires after this). */
export const DEFAULT_RENDEZVOUS_TTL_MS = 60_000;

/** Default ceiling on concurrent rendezvous. */
export const DEFAULT_MAX_RENDEZVOUS = 1024;

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
}
