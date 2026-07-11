import { describe, expect, it } from 'vitest';

import { deriveSessionKey, generatePairingSecret } from '../pairing.js';
import { deriveReconnectRendezvous, deriveReconnectSeed } from '../reconnect-rendezvous.js';

/**
 * REMOTE-013 E4 TC-03 — the reconnect rendezvous derivation: deterministic + isomorphic, a fresh room per
 * counter, and a DISJOINT room space per seed (the revoked-device-cannot-squat property).
 */

async function sessionKeyFor(secret: string): Promise<string> {
  return deriveSessionKey(secret);
}

describe('reconnect rendezvous (REMOTE-013 TC-03)', () => {
  it('deriveReconnectSeed is deterministic for a sessionKey', async () => {
    const sk = await sessionKeyFor(generatePairingSecret().secret);
    expect(await deriveReconnectSeed(sk)).toBe(await deriveReconnectSeed(sk));
  });

  it('deriveReconnectRendezvous is deterministic + base64url, and a fresh room per counter', async () => {
    const seed = await deriveReconnectSeed(await sessionKeyFor(generatePairingSecret().secret));
    const r0 = await deriveReconnectRendezvous(seed, 0);
    const r0b = await deriveReconnectRendezvous(seed, 0);
    const r1 = await deriveReconnectRendezvous(seed, 1);
    expect(r0).toBe(r0b); // isomorphic: same inputs → same room
    expect(r0).not.toBe(r1); // fresh room per counter
    expect(r0).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
  });

  it('a DIFFERENT sessionKey yields a disjoint room space (revoked device cannot squat)', async () => {
    // Two distinct pairings (device A vs device B) → distinct sessionKeys → distinct seeds → disjoint rooms.
    const seedA = await deriveReconnectSeed(await sessionKeyFor(generatePairingSecret().secret));
    const seedB = await deriveReconnectSeed(await sessionKeyFor(generatePairingSecret().secret));
    expect(seedA).not.toBe(seedB);
    const roomsA = new Set(
      await Promise.all([0, 1, 2, 3, 4].map((n) => deriveReconnectRendezvous(seedA, n))),
    );
    for (const n of [0, 1, 2, 3, 4]) {
      const roomBn = await deriveReconnectRendezvous(seedB, n);
      expect(roomsA.has(roomBn)).toBe(false); // B's rooms never collide with A's
    }
  });

  it('rejects a non-integer / negative counter (fail-closed)', async () => {
    const seed = await deriveReconnectSeed(await sessionKeyFor(generatePairingSecret().secret));
    await expect(deriveReconnectRendezvous(seed, -1)).rejects.toThrow(/non-negative integer/);
    await expect(deriveReconnectRendezvous(seed, 1.5)).rejects.toThrow(/non-negative integer/);
  });
});
