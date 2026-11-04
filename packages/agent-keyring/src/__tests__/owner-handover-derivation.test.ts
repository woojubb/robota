/**
 * A handover costs one passphrase derivation, the same as an unlock: the attach pair and the read
 * keys come from the one master key it recovers, which is zero-filled before the handover is
 * returned. Kept apart because it replaces the derivation module for the whole file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const observed = vi.hoisted(() => ({ derivations: 0, masterKeys: [] as Uint8Array[] }));

vi.mock('../kdf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kdf.js')>();
  return {
    ...actual,
    deriveKeyFromPassphrase: (...args: Parameters<typeof actual.deriveKeyFromPassphrase>) => {
      observed.derivations += 1;
      return actual.deriveKeyFromPassphrase(...args);
    },
    hkdf32: (...args: Parameters<typeof actual.hkdf32>) => {
      // The master key is the input of every keyring label's derivation.
      if (typeof args[1] === 'string' && args[1].startsWith('robota/keyring/v1/')) {
        observed.masterKeys.push(args[0]);
      }
      return actual.hkdf32(...args);
    },
  };
});

const { openOwnerHandover, parseKeyring } = await import('../index.js');
const { FIXTURE_PASSPHRASE_AS_TYPED } = await import('./helpers.js');

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);

describe('the handover derivation', () => {
  it('runs one passphrase derivation and wipes the master key it recovered', async () => {
    const handover = await openOwnerHandover(fixture, {
      type: 'passphrase',
      passphrase: FIXTURE_PASSPHRASE_AS_TYPED,
    });
    expect(observed.derivations).toBe(1);
    const masterKeys = observed.masterKeys.filter((key) => key.length === 32);
    expect(masterKeys.length).toBeGreaterThanOrEqual(3);
    for (const key of masterKeys) expect(key.every((byte) => byte === 0)).toBe(true);
    handover.dispose();
  });
});
