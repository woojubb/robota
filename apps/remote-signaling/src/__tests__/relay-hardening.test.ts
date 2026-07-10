import { describe, expect, it, vi } from 'vitest';

import { SignalingRelay, type ISignalingPeer } from '../relay.js';
import type { IClock, IScheduler } from '../rate-limiter.js';

/**
 * REMOTE-004 B2 — the relay's abuse controls (rate limit, single-use rendezvous, half-open TTL, concurrency cap)
 * are enforced INSIDE the relay and exercised here with injected clock + scheduler and in-memory fake peers — no
 * network, no real timers.
 */

let peerSeq = 0;
function fakePeer(
  remoteAddress?: string,
): ISignalingPeer & { readonly sent: string[]; closed: boolean } {
  const sent: string[] = [];
  const peer = {
    id: `peer_${(peerSeq += 1)}`,
    ...(remoteAddress ? { remoteAddress } : {}),
    sent,
    closed: false,
    send(raw: string): void {
      sent.push(raw);
    },
    close(): void {
      peer.closed = true;
    },
  };
  return peer;
}

function lastFrame(peer: { readonly sent: string[] }): Record<string, unknown> {
  return JSON.parse(peer.sent[peer.sent.length - 1]) as Record<string, unknown>;
}

function createFakeScheduler(): {
  scheduler: IScheduler;
  fireAll: () => void;
  pending: () => number;
} {
  const tasks: { cb: () => void; cancelled: boolean }[] = [];
  return {
    scheduler: {
      schedule(cb: () => void): () => void {
        const task = { cb, cancelled: false };
        tasks.push(task);
        return () => {
          task.cancelled = true;
        };
      },
    },
    fireAll(): void {
      for (const task of tasks) if (!task.cancelled) task.cb();
    },
    pending: () => tasks.filter((t) => !t.cancelled).length,
  };
}

const frozenClock: IClock = { now: () => 1_000 };

function join(relay: SignalingRelay, peer: ISignalingPeer, rendezvous = 'r'): void {
  relay.handleFrame(peer, JSON.stringify({ type: 'join', rendezvous }));
}

describe('SignalingRelay abuse-hardening (REMOTE-004 B2)', () => {
  it('TC-03: rate-limits join floods per source and never relays a rejected join', () => {
    const relay = new SignalingRelay({
      rateLimit: { burst: 2, refillPerMs: 0 },
      clock: frozenClock,
    });
    const p = fakePeer('9.9.9.9');
    join(relay, p); // token 1 → joined
    join(relay, p); // token 2 → joined (idempotent re-join)
    join(relay, p); // token 3 → rate-limited
    expect(lastFrame(p)).toEqual({ type: 'error', reason: 'rate-limited' });
  });

  it('TC-04: single-use — a new distinct peer is refused after the lifetime count reaches 2, even after a leave', () => {
    const relay = new SignalingRelay({ scheduler: createFakeScheduler().scheduler });
    const a = fakePeer();
    const b = fakePeer();
    join(relay, a);
    join(relay, b);
    relay.remove(a); // a leaves — room now holds only b
    const c = fakePeer(); // a brand-new distinct peer
    join(relay, c);
    expect(lastFrame(c)).toEqual({ type: 'error', reason: 'rendezvous-full' });
  });

  it('TC-04: idempotent re-join by an already-admitted peer is allowed', () => {
    const relay = new SignalingRelay({ scheduler: createFakeScheduler().scheduler });
    const a = fakePeer();
    join(relay, a);
    join(relay, a); // same peer id → allowed
    expect(lastFrame(a)).toEqual({ type: 'joined', rendezvous: 'r' });
  });

  it('TC-04: a half-open (one-peer) rendezvous expires after its TTL and the lone peer is closed', () => {
    const fake = createFakeScheduler();
    const relay = new SignalingRelay({ scheduler: fake.scheduler });
    const a = fakePeer();
    join(relay, a);
    expect(fake.pending()).toBe(1); // TTL armed while half-open
    fake.fireAll();
    expect(a.closed).toBe(true);
    expect(relay.rendezvousCount).toBe(0);
  });

  it('TC-04: the TTL timer is cancelled once the second peer joins', () => {
    const fake = createFakeScheduler();
    const relay = new SignalingRelay({ scheduler: fake.scheduler });
    const a = fakePeer();
    const b = fakePeer();
    join(relay, a);
    join(relay, b); // completes the pair → timer cancelled
    expect(fake.pending()).toBe(0);
    fake.fireAll(); // nothing to fire
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
  });

  it('TC-04: caps concurrent rendezvous (max-rendezvous)', () => {
    const relay = new SignalingRelay({
      maxRendezvous: 1,
      scheduler: createFakeScheduler().scheduler,
    });
    const a = fakePeer();
    const b = fakePeer();
    join(relay, a, 'ra'); // creates the only allowed rendezvous
    join(relay, b, 'rb'); // would be a 2nd concurrent rendezvous → refused
    expect(lastFrame(b)).toEqual({ type: 'error', reason: 'too-many-rendezvous' });
    expect(relay.rendezvousCount).toBe(1);
  });

  it('passes the widened join context (incl. remoteAddress) to a custom onJoinAttempt hook', () => {
    const onJoinAttempt = vi.fn().mockReturnValue(true);
    const relay = new SignalingRelay({
      hooks: { onJoinAttempt },
      scheduler: createFakeScheduler().scheduler,
    });
    const a = fakePeer('1.2.3.4');
    join(relay, a);
    expect(onJoinAttempt).toHaveBeenCalledWith({
      rendezvous: 'r',
      peerId: a.id,
      remoteAddress: '1.2.3.4',
    });
  });
});
