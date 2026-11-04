/**
 * Shared pieces of the owner-link tests: entropy that hands out fixed values in order, so a whole
 * exchange or handshake reproduces byte for byte, and the known answers those fixed values give.
 * The answers were computed outside this package (`hashlib`/`hmac` in Python for SHA-256, HMAC and
 * HKDF; the openssl CLI for X25519 and Ed25519), never by the code under test.
 */
import { Buffer } from 'node:buffer';

import { LinkRefusedError, type TLinkRefusalReason } from '../index.js';
import type { ILinkEntropy } from '../link-entropy.js';

/** 32 bytes counting up from `start`, wrapping at 0xff. */
export function sequence(start: number): Buffer {
  return Buffer.from(Array.from({ length: 32 }, (_, i) => (start + i) & 0xff));
}

/** Entropy that hands out `seeds` and `nonces` in order and fails loudly when one more is asked. */
export function fixedEntropy(
  seeds: readonly Uint8Array[],
  nonces: readonly Uint8Array[] = [],
): ILinkEntropy {
  const pendingSeeds = [...seeds];
  const pendingNonces = [...nonces];
  return {
    seed: () => {
      const next = pendingSeeds.shift();
      if (next === undefined) throw new Error('The test entropy has no seed left.');
      return Buffer.from(next);
    },
    nonce: () => {
      const next = pendingNonces.shift();
      if (next === undefined) throw new Error('The test entropy has no nonce left.');
      return Buffer.from(next);
    },
  };
}

/** The reason of the LinkRefusedError a call throws; anything else (or nothing) fails the test. */
export function refusalOf(call: () => unknown): TLinkRefusalReason {
  try {
    call();
  } catch (error) {
    if (error instanceof LinkRefusedError) return error.reason;
    throw error;
  }
  throw new Error('Expected a LinkRefusedError but nothing was thrown.');
}

export const KAT_SPAWNER_EPHEMERAL_SEED = sequence(0x60);
export const KAT_RUNTIME_EXCHANGE_SEED = sequence(0x80);
export const KAT_EXCHANGE = {
  spawnerEphemeral: '675dd574ed7789310b3d2e7681f3790b466c773b1521fecf36577958371ea52f',
  runtimeEphemeral: '493e82fc74464a59268817623d2053c5eb8e2cc4a988b4fee179ec6b010d531d',
  spawnerKey: 'e8d7dcca8e52899522ec48f0bd50f0734bc8627b140585247d9d1b91ba68c653',
} as const;
