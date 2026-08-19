import { describe, expect, it } from 'vitest';

import {
  isSameEnvironmentPeer,
  isTerminalPeerDelivery,
  type IPeerAdmission,
  type IPeerMessage,
  type TPeerDeliveryState,
} from '../peer-message-contracts.js';

const ORIGIN = { sessionId: 'session_peer_1' } as const;

function admission(over: Partial<IPeerAdmission> = {}): IPeerAdmission {
  return { admitted: true, trust: 'same-user-same-host', origin: ORIGIN, ...over };
}

describe('PEER-001 — delivery state is terminal or it is not (#1809)', () => {
  it('treats every state but `pending` as terminal', () => {
    // Asked as a question rather than re-listed at each call site: adding a state must not leave a
    // retry loop spinning on it because some caller's inline list was never updated.
    const terminal: TPeerDeliveryState[] = [
      'delivered',
      'acknowledged',
      'duplicate',
      'refused',
      'failed',
    ];
    for (const state of terminal) {
      expect(isTerminalPeerDelivery(state), state).toBe(true);
    }
    expect(isTerminalPeerDelivery('pending')).toBe(false);
  });

  it('narrows the type, which is why it is a predicate and not a boolean helper', () => {
    const state: TPeerDeliveryState = 'acknowledged';

    if (isTerminalPeerDelivery(state)) {
      // Compiles only because the predicate narrowed `state` away from 'pending'. A bare boolean
      // would leave this assignment a type error — the narrowing IS the contract.
      const settled: Exclude<TPeerDeliveryState, 'pending'> = state;
      expect(settled).toBe('acknowledged');
    } else {
      expect.unreachable('acknowledged is terminal');
    }
  });

  it('keeps `duplicate` distinct from `delivered`', () => {
    // The issue requires a deterministic, documented outcome for duplicates. A sender that cannot
    // tell a re-delivery from a first delivery cannot honour that, so the two are separate states
    // rather than one with a flag.
    expect(isTerminalPeerDelivery('duplicate')).toBe(true);
    expect<TPeerDeliveryState>('duplicate').not.toBe('delivered');
  });
});

describe('PEER-001 — possession and origin are two axes, not one (#1810)', () => {
  it('admits a same-environment peer and narrows its origin to present', () => {
    const result = admission();

    expect(isSameEnvironmentPeer(result)).toBe(true);
    if (isSameEnvironmentPeer(result)) {
      // `origin` is optional on the interface; the predicate is what makes it readable without a
      // check. An admitted peer with no origin is not a peer this can vouch for.
      expect(result.origin.sessionId).toBe('session_peer_1');
    }
  });

  it('does NOT treat a token-only peer as same-environment', () => {
    // The whole point of the split. A presented credential is copyable, so it says nothing about
    // where the peer runs — and a caller collapsing both into one boolean loses exactly that.
    expect(isSameEnvironmentPeer(admission({ trust: 'token-only' }))).toBe(false);
  });

  it('does NOT treat a refusal as same-environment however its trust reads', () => {
    expect(
      isSameEnvironmentPeer({ admitted: false, trust: 'same-user-same-host', origin: ORIGIN }),
    ).toBe(false);
    expect(isSameEnvironmentPeer({ admitted: false, trust: 'unproven', reason: 'no' })).toBe(false);
  });

  it('does NOT vouch for an admitted peer whose origin is missing', () => {
    // A result that claims the strongest trust while carrying no origin is malformed, and the
    // predicate refuses it rather than narrowing to a field that is not there.
    expect(isSameEnvironmentPeer({ admitted: true, trust: 'same-user-same-host' })).toBe(false);
  });
});

describe('PEER-001 — the message shape (#1809)', () => {
  it('separates stable identity from ordering', () => {
    // A retry repeats `id` and keeps `sequence`. Collapsing them would make every retry look like a
    // new message and defeat the duplicate rule the issue requires.
    const first: IPeerMessage = {
      id: 'msg_1',
      sequence: 1,
      origin: ORIGIN,
      text: 'hello',
      sentAt: 1,
    };
    const retry: IPeerMessage = { ...first, sentAt: 2 };

    expect(retry.id).toBe(first.id);
    expect(retry.sequence).toBe(first.sequence);
    expect(retry.sentAt).not.toBe(first.sentAt);
  });

  it('carries driverId as attribution only, never as an admission input', () => {
    // The issue is explicit: `TDriverId` must not become an authentication or authorization input.
    // Asserted structurally — the admission verdict is unchanged by who the driver claims to be.
    const withDriver = admission({ origin: { sessionId: 's', driverId: 'owner' } });
    const withoutDriver = admission({ origin: { sessionId: 's' } });

    expect(isSameEnvironmentPeer(withDriver)).toBe(isSameEnvironmentPeer(withoutDriver));

    const spoofed = admission({
      trust: 'token-only',
      origin: { sessionId: 's', driverId: 'owner' },
    });

    // Claiming the owner driver id does not upgrade what was proven about origin.
    expect(isSameEnvironmentPeer(spoofed)).toBe(false);
  });
});
