/**
 * Disposing a handover zero-fills the two secrets it holds besides the attach keypair: the sealing
 * seed and the authorship key. Kept apart because it wraps the two derivations for the whole file,
 * to see the very buffers the handover keeps.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const made = vi.hoisted(() => ({
  sealingSeeds: [] as Uint8Array[],
  authorshipKeys: [] as Uint8Array[],
}));

vi.mock('../key-pairs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../key-pairs.js')>();
  return {
    ...actual,
    deriveSealingSeed: (...args: Parameters<typeof actual.deriveSealingSeed>) => {
      const seed = actual.deriveSealingSeed(...args);
      made.sealingSeeds.push(seed);
      return seed;
    },
  };
});

vi.mock('../authorship.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../authorship.js')>();
  return {
    ...actual,
    deriveAuthorshipKey: (...args: Parameters<typeof actual.deriveAuthorshipKey>) => {
      const key = actual.deriveAuthorshipKey(...args);
      made.authorshipKeys.push(key);
      return key;
    },
  };
});

const { openOwnerHandover, parseKeyring } = await import('../index.js');
const { FIXTURE_RECOVERY_KEY } = await import('./helpers.js');

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);

describe('disposing a handover', () => {
  it('zero-fills the sealing seed and the authorship key it holds', async () => {
    const handover = await openOwnerHandover(fixture, {
      type: 'recoveryKey',
      recoveryKey: FIXTURE_RECOVERY_KEY,
    });
    expect(made.sealingSeeds).toHaveLength(1);
    expect(made.authorshipKeys).toHaveLength(1);
    const held = [made.sealingSeeds[0]!, made.authorshipKeys[0]!];
    for (const secret of held) {
      expect(secret).toHaveLength(32);
      expect(secret.some((byte) => byte !== 0)).toBe(true);
    }

    handover.dispose();
    for (const secret of held) expect(secret.every((byte) => byte === 0)).toBe(true);
  });
});
