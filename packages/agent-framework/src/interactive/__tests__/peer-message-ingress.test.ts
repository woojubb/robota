import { describe, expect, it } from 'vitest';

import { PeerMessageIngress, type IPeerIngressHost } from '../peer-message-ingress.js';

import type { IPeerMessageIngress, TPeerTrust } from '@robota-sdk/agent-interface-transport';

function ingress(
  over: { id?: string; sequence?: number; trust?: TPeerTrust; admitted?: boolean } = {},
) {
  const admitted = over.admitted ?? true;
  return {
    message: {
      id: over.id ?? 'msg_1',
      sequence: over.sequence ?? 1,
      origin: { sessionId: 'peer_a', driverId: 'owner' },
      text: 'hello',
      sentAt: 1,
    },
    admission: {
      admitted,
      trust: over.trust ?? 'same-user-same-host',
      ...(admitted ? { origin: { sessionId: 'peer_a' } } : { reason: 'not admitted' }),
    },
  } as IPeerMessageIngress;
}

/** A host that records what reached the runtime, and whose busy state the test drives. */
function host(): IPeerIngressHost & {
  delivered: IPeerMessageIngress[];
  busy: boolean;
  /** Model a real session: taking a message occupies it until the turn ends. */
  startsTurnOnDeliver: boolean;
} {
  const state = {
    delivered: [] as IPeerMessageIngress[],
    busy: false,
    startsTurnOnDeliver: false,
    isBusy: () => state.busy,
    deliver: (i: IPeerMessageIngress) => {
      state.delivered.push(i);
      if (state.startsTurnOnDeliver) state.busy = true;
    },
  };
  return state;
}

describe('PEER-002 — an idle session takes the message (#1809)', () => {
  it('delivers with the origin and trust intact', () => {
    // Both halves of the requirement: it reaches the runtime, AND it still says where it came from.
    // An agent answering a peer must be able to tell it is answering a peer.
    const h = host();
    const sut = new PeerMessageIngress(h);

    const result = sut.receive(ingress());

    expect(result.outcome).toBe('delivered');
    expect(result.ack.state).toBe('delivered');
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].message.origin.sessionId).toBe('peer_a');
    expect(h.delivered[0].admission.trust).toBe('same-user-same-host');
  });

  it('refuses a message whose peer was not admitted, before it reaches the runtime', () => {
    const h = host();
    const sut = new PeerMessageIngress(h);

    const result = sut.receive(ingress({ admitted: false }));

    expect(result.outcome).toBe('refused');
    expect(h.delivered).toHaveLength(0);
  });
});

describe('PEER-002 — a busy session queues rather than dropping or interleaving (#1809)', () => {
  it('queues while a turn is running, and says so in the ack', () => {
    // `delivered` would be a lie while it sits in a queue. `pending` is the contract's word for
    // "not settled", which is the truth the sender needs to keep waiting.
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);

    const result = sut.receive(ingress());

    expect(result.outcome).toBe('queued');
    expect(result.ack.state).toBe('pending');
    expect(result.queueDepth).toBe(1);
    expect(h.delivered).toHaveLength(0);
  });

  it('does NOT deliver concurrently — the single-claim invariant is the session’s, not ours', () => {
    // Running it anyway would violate the execution claim the rest of the session depends on, and
    // this module must not invent a second answer to a question the session already owns.
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);

    sut.receive(ingress({ id: 'm1', sequence: 1 }));
    sut.receive(ingress({ id: 'm2', sequence: 2 }));

    expect(h.delivered).toHaveLength(0);
    expect(sut.pending).toBe(2);
  });

  it('drains in arrival order once the turn finishes', () => {
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);
    sut.receive(ingress({ id: 'm1', sequence: 1 }));
    sut.receive(ingress({ id: 'm2', sequence: 2 }));

    h.busy = false;
    const drained = sut.drain();

    expect(drained.map((d) => d.message.id)).toEqual(['m1', 'm2']);
    expect(h.delivered.map((d) => d.message.id)).toEqual(['m1', 'm2']);
    expect(sut.pending).toBe(0);
  });

  it('drains nothing while still busy', () => {
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);
    sut.receive(ingress());

    expect(sut.drain()).toEqual([]);
    expect(sut.pending).toBe(1);
  });

  it('stops draining the moment a delivered message starts a turn', () => {
    // The failure this guards: delivering a message MAY start a turn — that is why it is delivered
    // — so a drain that read `isBusy()` once would hand the whole queue to a session that went busy
    // on the very first one. That is the concurrent delivery this class exists to prevent, and a
    // host whose `deliver` does not go busy cannot see it.
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);
    sut.receive(ingress({ id: 'm1', sequence: 1 }));
    sut.receive(ingress({ id: 'm2', sequence: 2 }));
    sut.receive(ingress({ id: 'm3', sequence: 3 }));

    h.busy = false;
    h.startsTurnOnDeliver = true; // a realistic session: the first message occupies it
    const drained = sut.drain();

    expect(drained.map((d) => d.message.id)).toEqual(['m1']);
    expect(h.delivered.map((d) => d.message.id)).toEqual(['m1']);
    expect(sut.pending).toBe(2);

    // ...and the rest are still there, in order, for the next drain.
    h.busy = false;
    h.startsTurnOnDeliver = false;
    expect(sut.drain().map((d) => d.message.id)).toEqual(['m2', 'm3']);
  });

  it('a message arriving while others wait does not overtake them', () => {
    // An idle session is not enough to deliver immediately: earlier messages are still queued, and
    // jumping ahead of them would reach the agent out of arrival order — the only order a peer
    // conversation has.
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);
    sut.receive(ingress({ id: 'm1', sequence: 1 }));

    h.busy = false;
    const late = sut.receive(ingress({ id: 'm2', sequence: 2 }));

    expect(late.outcome).toBe('queued');
    expect(h.delivered).toHaveLength(0);
    expect(sut.drain().map((d) => d.message.id)).toEqual(['m1', 'm2']);
  });

  it('refuses past the bound rather than growing without limit', () => {
    // An unbounded queue turns a chatty peer into a memory leak. Refusing tells the sender; a
    // silent drop would leave it holding an ack for a message that never lands.
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h, { maxQueued: 2 });

    sut.receive(ingress({ id: 'm1', sequence: 1 }));
    sut.receive(ingress({ id: 'm2', sequence: 2 }));
    const overflow = sut.receive(ingress({ id: 'm3', sequence: 3 }));

    expect(overflow.outcome).toBe('refused');
    expect(overflow.ack.reason).toMatch(/waiting for the running turn/);
    expect(sut.pending).toBe(2);
  });
});

describe('PEER-002 — the strict posture is opt-in, not assumed (#1809/#1810)', () => {
  it('accepts a token-only peer by default', () => {
    // #1809 owns message flow; #1810 owns admission. This module must not quietly become a second
    // admission gate, so the stricter posture is asked for explicitly.
    const h = host();
    const sut = new PeerMessageIngress(h);

    expect(sut.receive(ingress({ trust: 'token-only' })).outcome).toBe('delivered');
  });

  it('refuses a token-only peer when same-environment is required', () => {
    const h = host();
    const sut = new PeerMessageIngress(h, { requireSameEnvironment: true });

    const result = sut.receive(ingress({ trust: 'token-only' }));

    expect(result.outcome).toBe('refused');
    expect(result.ack.reason).toMatch(/copyable/);
    expect(h.delivered).toHaveLength(0);
  });

  it('accepts a same-environment peer under the same requirement', () => {
    const h = host();
    const sut = new PeerMessageIngress(h, { requireSameEnvironment: true });

    expect(sut.receive(ingress({ trust: 'same-user-same-host' })).outcome).toBe('delivered');
  });
});

describe('PEER-002 — shutdown and disconnect (#1809)', () => {
  it('returns what it abandoned so the sender can be told', () => {
    // A sender holding a `pending` ack would otherwise wait forever. Handing the messages back is
    // what lets the caller close that loop.
    const h = host();
    h.busy = true;
    const sut = new PeerMessageIngress(h);
    sut.receive(ingress({ id: 'm1', sequence: 1 }));
    sut.receive(ingress({ id: 'm2', sequence: 2 }));

    const abandoned = sut.abandon();

    expect(abandoned.map((a) => a.message.id)).toEqual(['m1', 'm2']);
    expect(sut.pending).toBe(0);
    expect(h.delivered).toHaveLength(0);
  });

  it('abandoning an empty queue is not an event', () => {
    const sut = new PeerMessageIngress(host());

    expect(sut.abandon()).toEqual([]);
  });
});
