import { describe, expect, it } from 'vitest';

import { SignalingRelay, type ISignalingPeer } from '../relay.js';

/** In-memory fake peer that records every frame it is sent — no socket, no network. */
function createFakePeer(
  id: string,
  remoteAddress?: string,
): ISignalingPeer & { readonly sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  return {
    id,
    ...(remoteAddress !== undefined ? { remoteAddress } : {}),
    sent,
    send(raw: string): void {
      sent.push(JSON.parse(raw) as Record<string, unknown>);
    },
    close(): void {
      /* no-op */
    },
  };
}

const T_A = 'a'.repeat(43);
const T_B = 'b'.repeat(43);
const T_C = 'c'.repeat(43);

function frame(peer: ISignalingPeer, relay: SignalingRelay, value: unknown): void {
  relay.handleFrame(peer, JSON.stringify(value));
}

describe('SignalingRelay presence and message (device inboxes)', () => {
  it('delivers a message verbatim only to the connection present at its topic', () => {
    const relay = new SignalingRelay();
    const alice = createFakePeer('alice');
    const bob = createFakePeer('bob');
    const carol = createFakePeer('carol');
    frame(alice, relay, { type: 'presence', topics: [T_A] });
    frame(bob, relay, { type: 'presence', topics: [T_B] });
    frame(carol, relay, { type: 'presence', topics: [T_C] });
    expect(alice.sent.at(-1)).toEqual({ type: 'present', topics: 1 });

    frame(alice, relay, { type: 'message', topic: T_B, data: { opaque: [1, 2] } });

    expect(bob.sent.at(-1)).toEqual({ type: 'message', topic: T_B, data: { opaque: [1, 2] } });
    expect(carol.sent.some((f) => f.type === 'message')).toBe(false);
    expect(alice.sent.some((f) => f.type === 'message')).toBe(false);
  });

  it('answers `absent` when nobody is present at the topic, and never echoes to the sender', () => {
    const relay = new SignalingRelay();
    const alice = createFakePeer('alice');
    frame(alice, relay, { type: 'presence', topics: [T_A] });

    frame(alice, relay, { type: 'message', topic: T_B, data: 'x' });
    expect(alice.sent.at(-1)).toEqual({ type: 'absent', topic: T_B });

    frame(alice, relay, { type: 'message', topic: T_A, data: 'x' });
    expect(alice.sent.at(-1)).toEqual({ type: 'absent', topic: T_A });
  });

  it('refuses a message from a connection that has not declared presence', () => {
    const relay = new SignalingRelay();
    const bob = createFakePeer('bob');
    const stranger = createFakePeer('stranger');
    frame(bob, relay, { type: 'presence', topics: [T_B] });

    frame(stranger, relay, { type: 'message', topic: T_B, data: 'x' });

    expect(stranger.sent.at(-1)).toEqual({ type: 'error', reason: 'not-present' });
    expect(bob.sent.some((f) => f.type === 'message')).toBe(false);
  });

  it('refuses malformed topics: too short, wrong alphabet, too many, not an array', () => {
    const relay = new SignalingRelay({ rateLimit: { burst: 10, refillPerMs: 0 } });
    const peer = createFakePeer('p');
    for (const topics of [
      ['short'],
      ['!'.repeat(43)],
      [],
      'x',
      Array.from({ length: 65 }, (_, i) => `${i}`.padStart(43, 'q')),
    ]) {
      frame(peer, relay, { type: 'presence', topics });
      expect(peer.sent.at(-1)).toEqual({ type: 'error', reason: 'invalid-topic' });
    }
    frame(peer, relay, { type: 'presence', topics: [T_A] });
    frame(peer, relay, { type: 'message', topic: 'short', data: 'x' });
    expect(peer.sent.at(-1)).toEqual({ type: 'error', reason: 'invalid-topic' });
  });

  it('a newer presence at a topic takes it over, so a restarted device is not locked out by its stale connection', () => {
    const relay = new SignalingRelay();
    const stale = createFakePeer('stale');
    const fresh = createFakePeer('fresh');
    const sender = createFakePeer('sender');
    frame(stale, relay, { type: 'presence', topics: [T_B] });
    frame(fresh, relay, { type: 'presence', topics: [T_B] });
    frame(sender, relay, { type: 'presence', topics: [T_A] });

    frame(sender, relay, { type: 'message', topic: T_B, data: 'hi' });

    expect(fresh.sent.at(-1)).toEqual({ type: 'message', topic: T_B, data: 'hi' });
    expect(stale.sent.some((f) => f.type === 'message')).toBe(false);
  });

  it('forgets a connection on remove, and replacing presence drops the old topics', () => {
    const relay = new SignalingRelay();
    const bob = createFakePeer('bob');
    const alice = createFakePeer('alice');
    frame(alice, relay, { type: 'presence', topics: [T_A] });
    frame(bob, relay, { type: 'presence', topics: [T_B, T_C] });
    expect(relay.presenceTopicCount).toBe(3);

    frame(bob, relay, { type: 'presence', topics: [T_C] });
    frame(alice, relay, { type: 'message', topic: T_B, data: 'x' });
    expect(alice.sent.at(-1)).toEqual({ type: 'absent', topic: T_B });

    relay.remove(bob);
    expect(relay.presenceTopicCount).toBe(1);
    frame(alice, relay, { type: 'message', topic: T_C, data: 'x' });
    expect(alice.sent.at(-1)).toEqual({ type: 'absent', topic: T_C });
  });

  it('bounds presence declarations per source and messages per connection', () => {
    const relay = new SignalingRelay({
      rateLimit: { burst: 2, refillPerMs: 0 },
      messageRate: { burst: 2, refillPerMs: 0 },
      clock: { now: () => 0 },
    });
    const alice = createFakePeer('alice', '10.0.0.1');
    const bob = createFakePeer('bob', '10.0.0.2');
    frame(alice, relay, { type: 'presence', topics: [T_A] });
    frame(alice, relay, { type: 'presence', topics: [T_A] });
    frame(alice, relay, { type: 'presence', topics: [T_A] });
    expect(alice.sent.at(-1)).toEqual({ type: 'error', reason: 'rate-limited' });

    frame(bob, relay, { type: 'presence', topics: [T_B] });
    frame(alice, relay, { type: 'message', topic: T_B, data: 1 });
    frame(alice, relay, { type: 'message', topic: T_B, data: 2 });
    frame(alice, relay, { type: 'message', topic: T_B, data: 3 });
    expect(alice.sent.at(-1)).toEqual({ type: 'error', reason: 'message-rate-limited' });
    expect(bob.sent.filter((f) => f.type === 'message')).toHaveLength(2);
  });

  it('one source cannot take the whole board', () => {
    const relay = new SignalingRelay({
      maxPresenceTopics: 1000,
      maxPresenceTopicsPerSource: 3,
      rateLimit: { burst: 100, refillPerMs: 0 },
    });
    const topic = (n: number): string => `${n}`.padStart(43, 'x');
    const first = createFakePeer('first', '10.0.0.9');
    const second = createFakePeer('second', '10.0.0.9');
    const elsewhere = createFakePeer('elsewhere', '10.0.0.10');
    frame(first, relay, { type: 'presence', topics: [topic(1), topic(2)] });
    frame(second, relay, { type: 'presence', topics: [topic(3), topic(4)] });
    expect(second.sent.at(-1)).toEqual({ type: 'error', reason: 'too-many-topics' });
    frame(elsewhere, relay, { type: 'presence', topics: [topic(3), topic(4)] });
    expect(elsewhere.sent.at(-1)).toEqual({ type: 'present', topics: 2 });

    // What a source releases, it may declare again.
    relay.remove(first);
    frame(second, relay, { type: 'presence', topics: [topic(5), topic(6), topic(7)] });
    expect(second.sent.at(-1)).toEqual({ type: 'present', topics: 3 });
  });

  it('caps the topics held relay-wide', () => {
    const relay = new SignalingRelay({
      maxPresenceTopics: 2,
      rateLimit: { burst: 10, refillPerMs: 0 },
    });
    const alice = createFakePeer('alice');
    const bob = createFakePeer('bob');
    frame(alice, relay, { type: 'presence', topics: [T_A, T_B] });
    frame(bob, relay, { type: 'presence', topics: [T_C] });
    expect(bob.sent.at(-1)).toEqual({ type: 'error', reason: 'too-many-topics' });
    expect(relay.presenceTopicCount).toBe(2);
  });
});
