/**
 * SEC-008 — the admission seam's own cases.
 *
 * `resolveAdmission` had none. It was exercised only THROUGH the four transports that call it, and
 * both defects review found here are ones that indirection hides: a transport passing a well-formed
 * config never exhibits either.
 *
 * The seam's whole claim is "one place to read and one place to change". A seam nobody tests
 * directly is one place to read and four places to find out you were wrong.
 */

import { describe, expect, it } from 'vitest';

import { resolveAdmission } from '../admission.js';

const OPEN_REASON = 'loopback only, the port is bound to 127.0.0.1';

describe('resolveAdmission is secure by default', () => {
  it('mints when nothing is asked for', () => {
    const admission = resolveAdmission();

    expect(admission.token).toMatch(/^[0-9a-f]{64}$/);
    expect(admission.openReason).toBeUndefined();
  });

  it('keeps an explicit token', () => {
    expect(resolveAdmission({ token: 'chosen-by-the-host' })).toEqual({
      token: 'chosen-by-the-host',
    });
  });

  it('opens only with a reason', () => {
    expect(resolveAdmission({ open: true, openReason: OPEN_REASON })).toEqual({
      token: null,
      openReason: OPEN_REASON,
    });
    expect(() => resolveAdmission({ open: true })).toThrow(/requires `openReason`/);
    expect(() => resolveAdmission({ open: true, openReason: '   ' })).toThrow(
      /requires `openReason`/,
    );
  });

  it('MINTS for an empty-string token rather than requiring the empty string', () => {
    // The value behind the discriminator defect. `{ token: '' }` is documented as "mint a fresh
    // one", and the HTTP route's `'token' in options.admission` read it as ALREADY RESOLVED and
    // installed the empty string as the required credential — which a peer sending an empty bearer
    // then matches. The route no longer discriminates; this pins the value it depends on.
    expect(resolveAdmission({ token: '' }).token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveAdmission is idempotent', () => {
  // Why it must be: the HTTP route accepts either shape, and BOTH interfaces declare a `token`, so
  // they cannot be told apart structurally. Making the function accept its own output deletes that
  // question instead of answering it wrongly.
  it('returns an already-resolved token admission unchanged', () => {
    const resolved = resolveAdmission({ token: 'chosen-by-the-host' });

    expect(resolveAdmission(resolved)).toEqual(resolved);
  });

  it('returns an already-resolved OPEN admission unchanged, reason and all', () => {
    // The case that made the old code wrong in the dangerous direction: re-resolving an open
    // admission through a config-shaped path either minted a token nobody holds or dropped the
    // reason and left an unexplained open transport.
    const resolved = resolveAdmission({ open: true, openReason: OPEN_REASON });

    expect(resolved).toEqual({ token: null, openReason: OPEN_REASON });
    expect(resolveAdmission(resolved)).toEqual(resolved);
  });

  it('REFUSES an open admission that arrives without its reason', () => {
    // `token: null` is the recorded outcome of a decision. One reaching here with no reason was
    // hand-built or corrupted, and both are the unexplained-open state the reason exists to
    // prevent — so it is refused rather than passed through.
    expect(() => resolveAdmission({ token: null })).toThrow(/requires `openReason`/);
  });
});

describe('resolveAdmission refuses a contradiction', () => {
  it('throws when a token and `open: true` are asked for together', () => {
    // Review: `WebRtcTransport` already refused the analogous `secret` + `open` pair in its own
    // constructor, so only WebRTC callers were protected. The old seam gave silent precedence to
    // the token — the safe DIRECTION, but the wrong ANSWER: a caller that wrote both does not know
    // what it is asking for, and one of the two things it believes is false.
    expect(() =>
      resolveAdmission({ token: 'a-credential', open: true, openReason: OPEN_REASON }),
    ).toThrow(/contradictory/);
  });

  it('still accepts `open: false` beside a token, which is not a contradiction', () => {
    // `open: false` says the same thing the token does. Refusing it would turn a redundant but
    // coherent config into an error, which is over-blocking for nothing.
    expect(resolveAdmission({ token: 'a-credential', open: false })).toEqual({
      token: 'a-credential',
    });
  });
});
