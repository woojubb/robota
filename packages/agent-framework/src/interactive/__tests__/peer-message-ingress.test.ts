import { describe, expect, it } from 'vitest';

import { PeerMessageIngress, type IPeerIngressHost } from '../peer-message-ingress.js';
import { TurnNotRunError } from '../turn-not-run-error.js';

import type {
  IPeerMessageIngress,
  IPeerOrigin,
  ITurnHandle,
  TPeerTrust,
  TTurnNotRunReason,
} from '@robota-sdk/agent-interface-transport';

function ingress(
  over: { id?: string; sequence?: number; trust?: TPeerTrust; admitted?: boolean } = {},
) {
  const admitted = over.admitted ?? true;
  return {
    message: {
      id: over.id ?? 'msg_1',
      sequence: over.sequence ?? 1,
      origin: { sessionId: 'peer_a', driverId: 'peer:peer_a' },
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

/**
 * A host standing in for the session's submit path — it records what was submitted and lets the test
 * settle the turn the way the real one does: a result, or a typed never-ran refusal.
 */
function host(): IPeerIngressHost & {
  submitted: { input: string; origin: IPeerOrigin }[];
  settle: (reason?: TTurnNotRunReason) => void;
  rejectSubmit?: Error;
} {
  let settleTurn: (() => void) | undefined;
  const state = {
    submitted: [] as { input: string; origin: IPeerOrigin }[],
    rejectSubmit: undefined as Error | undefined,
    settle: (reason?: TTurnNotRunReason) => settleTurn?.(),
    submit: async (input: string, origin: IPeerOrigin): Promise<ITurnHandle> => {
      if (state.rejectSubmit) throw state.rejectSubmit;
      state.submitted.push({ input, origin });
      const turnId = `turn_${state.submitted.length}`;
      let done: (v: unknown) => void = () => {};
      let fail: (e: unknown) => void = () => {};
      const completed = new Promise((resolve, reject) => {
        done = resolve;
        fail = reject;
      });
      state.settle = (reason?: TTurnNotRunReason) =>
        reason === undefined ? done({ ok: true }) : fail(new TurnNotRunError(turnId, reason));
      settleTurn = () => done({ ok: true });
      return { turnId, completed } as unknown as ITurnHandle;
    },
  };
  return state;
}

describe('PEER-002 — the message reaches the runtime, still saying where it came from (#1809)', () => {
  it('submits the peer text attributed to the peer', async () => {
    const h = host();

    const result = await new PeerMessageIngress(h).receive(ingress());

    expect(result.outcome).toBe('accepted');
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0].input).toBe('hello');
    expect(h.submitted[0].origin.sessionId).toBe('peer_a');
  });

  it('the immediate ack says pending, not delivered', async () => {
    // The runtime may not have it in hand — it can be waiting behind a running turn. `pending` is
    // the contract's word for "not settled", and it is the only one that is true at this moment.
    const h = host();

    const result = await new PeerMessageIngress(h).receive(ingress());

    expect(result.ack.state).toBe('pending');
  });

  it('refuses a message whose peer was not admitted, before it reaches the runtime', async () => {
    const h = host();

    const result = await new PeerMessageIngress(h).receive(ingress({ admitted: false }));

    expect(result.outcome).toBe('refused');
    expect(result.ack.state).toBe('refused');
    expect(result.settled).toBeUndefined();
    expect(h.submitted).toHaveLength(0);
  });
});

describe('PEER-002 — the session settles the turn, and that settlement IS the ack (#1809)', () => {
  it('a turn that ran acknowledges', async () => {
    const h = host();
    const result = await new PeerMessageIngress(h).receive(ingress());

    h.settle();

    expect((await result.settled)?.state).toBe('acknowledged');
  });

  // 'coalesced' — a newer message from this peer superseded it; 'dropped' — the pending queue was
  // full; 'cancelled' — the session cancelled it. Every reason the queue can settle with.
  it.each(['coalesced', 'dropped', 'cancelled'] as const)(
    'reports %s as the typed reason, not a message string',
    async (reason) => {
      // RUNTIME-003's whole point: these are different facts, and a sender forced to regex-match an
      // error message to tell them apart has learned nothing it can act on.
      const h = host();
      const result = await new PeerMessageIngress(h).receive(ingress());

      h.settle(reason);
      const ack = await result.settled;

      expect(ack?.state).toBe('refused');
      expect(ack?.reason).toBe(reason);
    },
  );

  it('a session that is shutting down refuses rather than throwing at the channel pump', async () => {
    const h = host();
    h.rejectSubmit = new Error('Interactive session is shutting down.');

    const result = await new PeerMessageIngress(h).receive(ingress());

    expect(result.outcome).toBe('refused');
    expect(result.ack.reason).toMatch(/shutting down/);
  });
});

describe('PEER-002 — the strict posture is opt-in, not assumed (#1809/#1810)', () => {
  it('accepts a token-only peer by default', async () => {
    // #1809 owns message flow; #1810 owns admission. This module must not quietly become a second
    // admission gate, so the stricter posture is asked for explicitly.
    const h = host();

    const result = await new PeerMessageIngress(h).receive(ingress({ trust: 'token-only' }));

    expect(result.outcome).toBe('accepted');
  });

  it('refuses a token-only peer when same-environment is required', async () => {
    const h = host();
    const sut = new PeerMessageIngress(h, { requireSameEnvironment: true });

    const result = await sut.receive(ingress({ trust: 'token-only' }));

    expect(result.outcome).toBe('refused');
    expect(result.ack.reason).toMatch(/copyable/);
    expect(h.submitted).toHaveLength(0);
  });

  it('accepts a same-environment peer under the same requirement', async () => {
    const h = host();
    const sut = new PeerMessageIngress(h, { requireSameEnvironment: true });

    expect((await sut.receive(ingress({ trust: 'same-user-same-host' }))).outcome).toBe('accepted');
  });
});
