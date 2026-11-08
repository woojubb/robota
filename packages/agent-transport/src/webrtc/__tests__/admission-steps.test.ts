import { describe, expect, it } from 'vitest';

import { nextAdmissionStep } from '../admission-steps.js';

/**
 * The ordering carries the security argument, so it is asserted directly rather than only through a
 * channel: each step must run on a channel the previous one has already bound.
 */

const PROOF = {};

describe('what a channel still owes', () => {
  it('owes nothing when nothing is configured — the handshake alone admits', () => {
    expect(nextAdmissionStep({}, 'pairing')).toBe(null);
  });

  it.each([
    ['only the rendezvous', { localPeer: PROOF }, 'local-proof'],
    ['only the grant', { handoffGrant: PROOF }, 'handoff-grant'],
    ['both — the rendezvous first', { localPeer: PROOF, handoffGrant: PROOF }, 'local-proof'],
  ])('with %s configured, owes %s', (_label, configured, expected) => {
    expect(nextAdmissionStep(configured, 'pairing')).toBe(expected);
  });

  it('owes the grant once the rendezvous has run', () => {
    expect(nextAdmissionStep({ localPeer: PROOF, handoffGrant: PROOF }, 'local-proof')).toBe(
      'handoff-grant',
    );
  });

  it('owes nothing once both have run', () => {
    expect(nextAdmissionStep({ localPeer: PROOF, handoffGrant: PROOF }, 'handoff-grant')).toBe(
      null,
    );
  });

  it('does not re-demand the rendezvous after the grant state is reached', () => {
    // The loop this prevents: a gate that asked for the rendezvous again from `handoff-grant` would
    // never admit anyone, because the peer has no second nonce to present.
    expect(nextAdmissionStep({ localPeer: PROOF }, 'handoff-grant')).toBe(null);
  });

  it('owes nothing after a rendezvous-only channel has satisfied it', () => {
    expect(nextAdmissionStep({ localPeer: PROOF }, 'local-proof')).toBe(null);
  });
});
