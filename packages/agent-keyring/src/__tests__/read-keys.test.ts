/**
 * What an unlock yields is what reading needs and nothing more: the sealing keypair and the
 * authorship key. The attach keypair, which proves ownership to a verifier, is reachable from none
 * of it, so a process that holds read keys for a while can read and vouch but never present itself
 * as the owner.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KeyObject } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  checkSealingPublicKey,
  createKeyring,
  getSealingPublicKey,
  parseKeyring,
  repairSealingPublicKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type IReadKeys,
} from '../index.js';
import {
  FIXTURE_PASSPHRASE_AS_TYPED,
  FIXTURE_RECOVERY_KEY,
  KNOWN_SEALING_PUBLIC_KEY_HEX,
  codeOf,
  hex,
  reachableValues,
} from './helpers.js';

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);

function keyTypes(keys: IReadKeys): string[] {
  return reachableValues(keys)
    .filter((value): value is KeyObject => value instanceof KeyObject)
    .map((key) => `${key.type}:${key.asymmetricKeyType ?? 'secret'}`)
    .sort();
}

describe('read keys', () => {
  it('are what every unlock yields, with the sealing keypair and no attach keypair', async () => {
    const created = await createKeyring({ passphrase: 'a passphrase for this test' });
    for (const keys of [
      await unlockWithPassphrase(fixture, FIXTURE_PASSPHRASE_AS_TYPED),
      await unlockWithRecoveryKey(fixture, FIXTURE_RECOVERY_KEY),
      created.unlocked,
    ]) {
      expect('attach' in keys).toBe(false);
      expect(keyTypes(keys)).toEqual(['private:x25519']);
      keys.lock();
    }
  });

  it('carry what the sealing-key check and repair need, and stop doing so once locked', async () => {
    const keys = await unlockWithRecoveryKey(fixture, FIXTURE_RECOVERY_KEY);
    const swapped = { ...fixture, sealingPublicKey: 'A'.repeat(42) + 'E' };
    expect(checkSealingPublicKey(swapped, keys)).toEqual({ matches: false });
    const repaired = repairSealingPublicKey(swapped, keys);
    expect(hex(getSealingPublicKey(repaired))).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
    keys.lock();
    expect(codeOf(() => checkSealingPublicKey(fixture, keys))).toBe('keys-locked');
    expect(codeOf(() => repairSealingPublicKey(swapped, keys))).toBe('keys-locked');
  });
});
