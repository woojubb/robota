import { describe, expect, it, vi } from 'vitest';

import { randomId } from './random-id';

/**
 * CORE-028 — five modules imported `randomUUID` from `node:crypto`, so the first line of this
 * package's BROWSER bundle was `import{randomUUID}from"node:crypto"`, and `apps/agent-web` carries
 * webpack aliases plus two hand-written stub modules to patch around it.
 *
 * `globalThis.crypto.randomUUID()` is the same function in both places. The cases below are about
 * the platform contract, because that is what the source change relies on.
 */
describe('randomId (CORE-028)', () => {
  it('produces a v4 UUID', () => {
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces distinct values', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
  });

  /**
   * `crypto.randomUUID` requires a SECURE CONTEXT in browsers, so a page served over plain HTTP has
   * `crypto` but not that method. An id generator that threw there would take the session with it,
   * so the fallback builds the same v4 shape from `getRandomValues`, which needs no secure context.
   */
  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const real = globalThis.crypto;
    // Real randomness, minus `randomUUID` — the shape a browser has outside a secure context.
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    try {
      expect(randomId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('THROWS rather than inventing randomness when the platform has none', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      // Math.random here would be worse than failing: the ids are used as message and execution
      // identities, and a collision is silent.
      expect(() => randomId()).toThrow(/cryptographic randomness/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
