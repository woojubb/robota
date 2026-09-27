/**
 * #3289 §3 — direct unit coverage for `isSameSurface` / `humanDriverLabel` / `driverAttributionText`.
 * Component tests (`ConversationView`, `PermissionPrompt`) exercise these indirectly; this file pins
 * the rule itself, including a regression a review round caught: `'remote:ws'` (a plain WS viewer's
 * own id) and `'peer:<sessionId>'` (an unrelated REMOTE-014 mesh peer's turn) must NEVER compare equal
 * under `isSameSurface`, even though both render the same "a remote device" label text — collapsing
 * them into one kind would hide a peer's turn on a plain remote-WS viewer as if it were this
 * connection's own, the exact class of bug this module exists to prevent.
 */

import { describe, expect, it } from 'vitest';

import { driverAttributionText, humanDriverLabel, isSameSurface } from '../driver-labels.js';

describe('isSameSurface', () => {
  it('is true for the reserved local-operator id, regardless of what this connection has learned', () => {
    expect(isSameSurface('owner', null)).toBe(true);
    expect(isSameSurface('owner', 'browser')).toBe(true);
  });

  it('is false for the agent\'s own wake-ups, always — "automatic" is never "the same surface"', () => {
    expect(isSameSurface('agent', null)).toBe(false);
    expect(isSameSurface('agent', 'browser')).toBe(false);
  });

  it('is false while this connection has not yet learned its own id', () => {
    expect(isSameSurface('browser', null)).toBe(false);
  });

  it('is true for the exact same literal id (this connection\'s own, or another window of the same kind)', () => {
    expect(isSameSurface('browser', 'browser')).toBe(true);
    expect(isSameSurface('app', 'app')).toBe(true);
  });

  it('is true across two ids of the same kind (e.g. two attached-terminal connections)', () => {
    expect(isSameSurface('attach:2', 'attach:1')).toBe(true);
  });

  it('is false across different kinds of surface', () => {
    expect(isSameSurface('app', 'browser')).toBe(false);
    expect(isSameSurface('attach:1', 'browser')).toBe(false);
    expect(isSameSurface('browser', 'app')).toBe(false);
  });

  it('REGRESSION: a mesh peer\'s turn is never "the same surface" as a plain WS viewer\'s own id, even though both display as "a remote device"', () => {
    // 'remote:ws' is the id a plain (non-desktop, non--open) WS connection learns as its OWN id.
    // 'peer:<sessionId>' is a REMOTE-014 mesh peer's turn, broadcast to every connected surface —
    // an unrelated co-driver, never this connection's own turn.
    expect(isSameSurface('peer:session-abc123', 'remote:ws')).toBe(false);
    expect(isSameSurface('remote:ws', 'remote:ws')).toBe(true);
  });
});

describe('humanDriverLabel / driverAttributionText', () => {
  it('names each recognized kind in plain words, never a raw id', () => {
    expect(humanDriverLabel('attach:3')).toBe('the terminal');
    expect(humanDriverLabel('app')).toBe('the desktop app');
    expect(humanDriverLabel('browser')).toBe('the browser');
    expect(humanDriverLabel('remote:ws')).toBe('a remote device');
    expect(humanDriverLabel('peer:session-abc123')).toBe('a remote device');
  });

  it('falls back to the least presumptuous label for an id it does not recognize, never echoing it back', () => {
    expect(humanDriverLabel('some-future-id')).toBe('another surface');
  });

  it('renders "from <label>" for a co-driver, and the bare word "automatic" for the agent', () => {
    expect(driverAttributionText('browser')).toBe('from the browser');
    expect(driverAttributionText('agent')).toBe('automatic');
  });
});
