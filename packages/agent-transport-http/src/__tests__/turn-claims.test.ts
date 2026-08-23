/**
 * RUNTIME-38 — the claim registry's own contract.
 *
 * It was exercised only through `routes.test.ts`, which asks HTTP questions and gets HTTP answers.
 * Review asked for these directly, and the reason is the one this repository keeps rediscovering: a
 * branch reached only through a wrapper is a branch whose behaviour is inferred. `keyFor` has three
 * outcomes and two of them are about a session that misbehaves — the shapes an HTTP case would have
 * to build a broken session to reach at all.
 */

import { describe, expect, it } from 'vitest';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';

import { createTurnClaims } from '../turn-claims.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

/**
 * A session that names itself however the case needs it to.
 *
 * Built on the PUBLISHED conformant double rather than cast to the contract — `contract-cast-ratchet`
 * refuses another cast, and it is right to: a cast is a partial re-implementation nothing checks
 * against the real interface, so a member the contract gains later is silently absent from it.
 */
function sessionNamed(id: string): IInteractiveSession {
  return createTestInteractiveSession({
    getSession: () => ({ getSessionId: () => id }) as ReturnType<IInteractiveSession['getSession']>,
  });
}

describe('the key a session is claimed under', () => {
  it('is the id the session declares', () => {
    expect(createTurnClaims().keyFor(sessionNamed('session_a'))).toBe('session_a');
  });

  it('does NOT depend on object identity', () => {
    // The defect the id-keying replaced: a `sessionFactory` returning a fresh wrapper per call for
    // one logical session made every request look unclaimed, and the guard was silently absent.
    const claims = createTurnClaims();

    expect(claims.keyFor(sessionNamed('same'))).toBe(claims.keyFor(sessionNamed('same')));
  });

  it('is undefined when the session names itself with an empty string', () => {
    // Not `''`, which is a key: every unnameable session would collide into it and 409 each other.
    expect(createTurnClaims().keyFor(sessionNamed(''))).toBeUndefined();
  });

  it('is undefined when the session THROWS while naming itself', () => {
    const throwing = createTestInteractiveSession({
      getSession: () => {
        throw new Error('no session bound');
      },
    });

    expect(createTurnClaims().keyFor(throwing)).toBeUndefined();
  });
});

describe('holding and releasing a claim', () => {
  it('reports a key as held only between hold and release', () => {
    const claims = createTurnClaims();

    expect(claims.isHeld('a')).toBe(false);
    claims.hold('a');
    expect(claims.isHeld('a')).toBe(true);
    claims.release('a');
    expect(claims.isHeld('a')).toBe(false);
  });

  it('holds each session separately', () => {
    // PER SESSION, not one flag for the router: a busy neighbour is not a reason to refuse you, and
    // a single flag made one tenant's turn refuse every other tenant's.
    const claims = createTurnClaims();

    claims.hold('tenant_a');

    expect(claims.isHeld('tenant_a')).toBe(true);
    expect(claims.isHeld('tenant_b')).toBe(false);
  });

  it('releases a key that was never held without complaint', () => {
    // The teardown path runs in a `finally` and cannot know whether the claim was taken — a throw
    // there would replace the error being unwound with one about bookkeeping.
    const claims = createTurnClaims();

    expect(() => claims.release('never-held')).not.toThrow();
  });

  it('is idempotent on a second hold, so one release still frees it', () => {
    // The route holds once per request and releases once per request. Stating it here means a
    // future counting implementation has to decide deliberately rather than by accident.
    const claims = createTurnClaims();

    claims.hold('a');
    claims.hold('a');
    claims.release('a');

    expect(claims.isHeld('a')).toBe(false);
  });
});
