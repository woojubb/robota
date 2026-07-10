import { describe, expect, it } from 'vitest';

import { TokenBucketLimiter, type IClock } from '../rate-limiter.js';

function mutableClock(start = 0): IClock & { set(t: number): void } {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v) };
}

describe('TokenBucketLimiter (REMOTE-004 B2)', () => {
  it('allows up to the burst, then refuses until refill', () => {
    const clock = mutableClock(0);
    const limiter = new TokenBucketLimiter({ burst: 3, refillPerMs: 0.001 }, clock);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(false); // burst exhausted, no time passed
  });

  it('refills over time at the configured rate', () => {
    const clock = mutableClock(0);
    const limiter = new TokenBucketLimiter({ burst: 1, refillPerMs: 1 / 1000 }, clock); // 1 token/sec
    expect(limiter.tryConsume('ip')).toBe(true);
    expect(limiter.tryConsume('ip')).toBe(false);
    clock.set(1000); // +1s → +1 token
    expect(limiter.tryConsume('ip')).toBe(true);
  });

  it('keeps independent buckets per source key', () => {
    const clock = mutableClock(0);
    const limiter = new TokenBucketLimiter({ burst: 1, refillPerMs: 0 }, clock);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true); // separate bucket
  });
});
