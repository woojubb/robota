import { describe, expect, it } from 'vitest';

import {
  acknowledgePeerMessage,
  admitPeerMessage,
  createPeerMessageLedger,
  forgetPeerOrigin,
} from '../peer-message-ledger.js';

import type { IPeerMessage } from '@robota-sdk/agent-interface-transport';

function message(over: Partial<IPeerMessage> = {}): IPeerMessage {
  return {
    id: 'msg_1',
    sequence: 1,
    origin: { sessionId: 'peer_a' },
    text: 'hello',
    sentAt: 1,
    ...over,
  };
}

describe('PEER-001 — a retry gets the ORIGINAL answer back (#1809)', () => {
  it('delivers a first message and refuses to deliver its retry', () => {
    const ledger = createPeerMessageLedger();

    const first = admitPeerMessage(ledger, message());
    const retry = admitPeerMessage(ledger, message({ sentAt: 2 }));

    expect(first.deliver).toBe(true);
    expect(first.ack.state).toBe('delivered');
    expect(retry.deliver).toBe(false);
    expect(retry.ack.state).toBe('duplicate');
  });

  it('a retry of a REFUSED message stays refused, not silently accepted', () => {
    // The property that makes a retry safe: a message must not get two contradictory answers. If
    // the second attempt were re-judged, an admission that failed once could pass on a retry.
    const ledger = createPeerMessageLedger();
    const refusal = { state: 'refused', reason: 'not admitted' } as const;

    const first = admitPeerMessage(ledger, message(), refusal);
    const retry = admitPeerMessage(ledger, message({ sentAt: 2 }));

    expect(first.ack.state).toBe('refused');
    expect(retry.ack.state).toBe('duplicate');
    expect(retry.deliver).toBe(false);
    // The original reason survives, so the sender can still tell WHY it never landed.
    expect(retry.ack.reason).toBe('not admitted');
  });

  it('carries the original sequence on the duplicate ack', () => {
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ sequence: 7 }));

    const retry = admitPeerMessage(ledger, message({ sequence: 7, sentAt: 9 }));

    expect(retry.ack.sequence).toBe(7);
  });
});

describe('PEER-001 — sequence is per origin (#1809)', () => {
  it('does not let one peer create a gap in another peer’s stream', () => {
    // Two peers are independent senders. A shared counter would make peer B's traffic look like a
    // gap in peer A's, and the session would wait for a message that was never coming.
    const ledger = createPeerMessageLedger();

    const a = admitPeerMessage(ledger, message({ id: 'a1', sequence: 1 }));
    const b = admitPeerMessage(
      ledger,
      message({ id: 'b1', sequence: 1, origin: { sessionId: 'peer_b' } }),
    );

    expect(a.deliver).toBe(true);
    expect(b.deliver).toBe(true);
    expect(a.gapBefore).toBeUndefined();
    expect(b.gapBefore).toBeUndefined();
  });

  it('reports a gap rather than silently reordering', () => {
    // Buffer-and-reorder is a policy the session layer may choose. Inventing it here would hide a
    // lost message behind an apparent success — the failure this contract exists to prevent.
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ id: 'm1', sequence: 1 }));

    const ahead = admitPeerMessage(ledger, message({ id: 'm3', sequence: 3 }));

    expect(ahead.deliver).toBe(true);
    expect(ahead.gapBefore).toBe(2);
  });

  it('delivers a gap when it arrives LATE, instead of refusing what it reported as missing', () => {
    // Found in review. The high-water form refused this: deliver 1, receive 3 (gap at 2 reported),
    // then 2 arrives and is rejected as "already used" — although it was never delivered. That
    // contradicted this module's own rule that a gap is REPORTED so the session layer can decide,
    // because the session never got the chance.
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ id: 'm1', sequence: 1 }));
    const ahead = admitPeerMessage(ledger, message({ id: 'm3', sequence: 3 }));

    const late = admitPeerMessage(ledger, message({ id: 'm2', sequence: 2 }));

    expect(ahead.gapBefore).toBe(2);
    expect(late.deliver).toBe(true);
    expect(late.ack.state).toBe('delivered');
  });

  it('does not rewind the frontier when a gap is filled late', () => {
    // The frontier only moves forward, so a LATER gap is still measured against the highest
    // sequence seen — filling 2 after 3 must not make 4 look like it follows 2.
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ id: 'm1', sequence: 1 }));
    admitPeerMessage(ledger, message({ id: 'm3', sequence: 3 }));
    admitPeerMessage(ledger, message({ id: 'm2', sequence: 2 }));

    const next = admitPeerMessage(ledger, message({ id: 'm5', sequence: 5 }));

    expect(next.gapBefore).toBe(4);
  });

  it('refuses a NEW id reusing an old sequence — that is a protocol error, not a retry', () => {
    // A retry repeats its id. A new id on an already-used sequence cannot be ordered against what
    // was delivered, so it is refused with the reason rather than guessed at.
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ id: 'm1', sequence: 1 }));

    const reused = admitPeerMessage(ledger, message({ id: 'm2', sequence: 1 }));

    expect(reused.deliver).toBe(false);
    expect(reused.ack.state).toBe('refused');
    expect(reused.ack.reason).toMatch(/already delivered by this origin/);
  });
});

describe('PEER-001 — delivery and acknowledgement are different questions (#1809)', () => {
  it('promotes a delivered message to acknowledged', () => {
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message());

    const acked = acknowledgePeerMessage(ledger, 'peer_a', 'msg_1');

    expect(acked?.state).toBe('acknowledged');
  });

  it('will not acknowledge something that was never delivered', () => {
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message(), { state: 'refused', reason: 'no' });

    expect(acknowledgePeerMessage(ledger, 'peer_a', 'msg_1')).toBeUndefined();
    expect(acknowledgePeerMessage(ledger, 'peer_a', 'never_seen')).toBeUndefined();
    expect(acknowledgePeerMessage(ledger, 'unknown_peer', 'msg_1')).toBeUndefined();
  });

  it('a duplicate after acknowledgement still reads as duplicate', () => {
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message());
    acknowledgePeerMessage(ledger, 'peer_a', 'msg_1');

    expect(admitPeerMessage(ledger, message({ sentAt: 5 })).ack.state).toBe('duplicate');
  });
});

describe('PEER-001 — disconnect and shutdown (#1809)', () => {
  it('forgetting an origin frees its sequence space for a reconnect', () => {
    // A peer that reconnects gets a fresh sequence space. Without this, its first message after a
    // restart would collide with the sequence it used before and be refused.
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ id: 'm1', sequence: 5 }));

    forgetPeerOrigin(ledger, 'peer_a');
    const afterReconnect = admitPeerMessage(ledger, message({ id: 'm2', sequence: 1 }));

    expect(afterReconnect.deliver).toBe(true);
    expect(afterReconnect.ack.state).toBe('delivered');
  });

  it('forgetting one origin leaves the others intact', () => {
    const ledger = createPeerMessageLedger();
    admitPeerMessage(ledger, message({ id: 'a1', sequence: 1 }));
    admitPeerMessage(ledger, message({ id: 'b1', sequence: 1, origin: { sessionId: 'peer_b' } }));

    forgetPeerOrigin(ledger, 'peer_a');

    // peer_b's record survives, so its next message is still ordered against what it sent.
    const b2 = admitPeerMessage(
      ledger,
      message({ id: 'b2', sequence: 1, origin: { sessionId: 'peer_b' } }),
    );
    expect(b2.ack.state).toBe('refused');
  });

  it('remembers nothing across a new ledger — state is per connection by construction', () => {
    const first = createPeerMessageLedger();
    admitPeerMessage(first, message());

    const fresh = createPeerMessageLedger();

    expect(admitPeerMessage(fresh, message()).ack.state).toBe('delivered');
  });
});
