/**
 * SEC-008 — a WebRTC transport with no pairing secret must not expose the session by omission.
 *
 * Two sibling transports made OPPOSITE default choices for one question. The WS transport auto-mints
 * a credential unless told to stay open; this one's `secret` was optional, and without it the data
 * channel was wired straight to the session — a remote peer reaching tool execution because a field
 * was left unset.
 *
 * The defect is the DEFAULT, not the open mode. Running without pairing is legitimate for loopback
 * and for tests; what is not legitimate is that it happened when nobody chose it. So the transport
 * now refuses to construct unless one of the two was chosen, and the refusal names both ways out.
 */

import { describe, expect, it } from 'vitest';

import { WebRtcTransport } from '../webrtc-transport.js';
import type { ISignalingClient } from '../signaling.js';

/** A signalling channel that is never used — these cases never get past the constructor. */
const signaling = {
  send: () => {},
  onMessage: () => () => {},
  close: () => {},
} as unknown as ISignalingClient;

describe('SEC-008: the WebRTC transport requires an admission decision', () => {
  it('refuses to construct with neither a secret nor an explicit open', () => {
    expect(() => new WebRtcTransport({ signaling })).toThrow(/openReason|secret/);
  });

  it('constructs with a pairing secret', () => {
    expect(() => new WebRtcTransport({ signaling, secret: 'pairing-secret' })).not.toThrow();
  });

  it('constructs open when the host says so, in writing', () => {
    expect(
      () =>
        new WebRtcTransport({
          signaling,
          open: true,
          openReason: 'loopback only — no remote peer',
        }),
    ).not.toThrow();
  });

  it('refuses an open transport with no reason', () => {
    // Without this the fix would be an option that means nothing: `open: true` alone would restore
    // exactly the silent exposure the case above forbids, one keyword further along.
    expect(() => new WebRtcTransport({ signaling, open: true })).toThrow(/openReason/);
  });

  it('refuses a secret AND an explicit open together', () => {
    // Silently ignoring one of two contradictory options is how a caller ends up believing the
    // channel is gated when it is, or is not, by whichever option happened to win. The constructor
    // cannot know which they meant, so it does not choose.
    expect(
      () =>
        new WebRtcTransport({ signaling, secret: 'pairing-secret', open: true, openReason: 'x' }),
    ).toThrow(/contradictory/);
  });
});
