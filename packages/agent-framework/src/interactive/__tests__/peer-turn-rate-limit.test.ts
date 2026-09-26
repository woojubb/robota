import { describe, expect, it } from 'vitest';

import { DEFAULT_PEER_TURN_RATE_WINDOWS, PeerTurnRateLimiter } from '../peer-turn-rate-limit.js';

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function admitMany(limiter: PeerTurnRateLimiter, sender: string, count: number): number {
  let admitted = 0;
  for (let i = 0; i < count; i += 1) if (limiter.admit(sender) === undefined) admitted += 1;
  return admitted;
}

describe('the per-sender limit on message-triggered turns', () => {
  it('refuses a burst over the minute limit and admits again once the minute has passed', () => {
    const time = clock();
    const limiter = new PeerTurnRateLimiter(DEFAULT_PEER_TURN_RATE_WINDOWS, time.now);
    expect(admitMany(limiter, 'peer:A', 10)).toBe(6);
    expect(limiter.admit('peer:A')).toMatch(/too many messages from peer:A/);
    time.advance(60_000);
    expect(limiter.admit('peer:A')).toBeUndefined();
  });

  it('bounds a sender that stays under the minute limit by the hour limit', () => {
    const time = clock();
    const limiter = new PeerTurnRateLimiter(DEFAULT_PEER_TURN_RATE_WINDOWS, time.now);
    let admitted = 0;
    for (let minute = 0; minute < 59; minute += 1) {
      admitted += admitMany(limiter, 'peer:A', 6);
      time.advance(60_000);
    }
    expect(admitted).toBe(30);
    time.advance(60_000);
    expect(limiter.admit('peer:A')).toBeUndefined();
  });

  it('counts each sender separately', () => {
    const limiter = new PeerTurnRateLimiter(DEFAULT_PEER_TURN_RATE_WINDOWS, clock().now);
    expect(admitMany(limiter, 'peer:A', 6)).toBe(6);
    expect(limiter.admit('peer:A')).toBeDefined();
    expect(limiter.admit('peer:B')).toBeUndefined();
  });
});
