import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkSealingPublicKey,
  fingerprint,
  getSealingPublicKey,
  parseKeyring,
  serializeKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
} from '../index.js';
import { ATTACH_KEY_LABEL, deriveKeyPairs, SEALING_KEY_LABEL } from '../key-pairs.js';
import { ARTIFACT_KEY_WRAP_LABEL } from '../sealing.js';
import { RECOVERY_KEK_LABEL } from '../keyslot.js';
import {
  FIXED_MASTER_KEY,
  FIXTURE_PASSPHRASE_AS_TYPED,
  FIXTURE_RECOVERY_KEY,
  hex,
  KNOWN_ATTACH_PUBLIC_KEY_HEX,
  KNOWN_SEALING_PUBLIC_KEY_HEX,
} from './helpers.js';

const fixtureText = readFileSync(
  fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)),
  'utf8',
);

describe('known answers', () => {
  it('pins the HKDF labels', () => {
    expect(SEALING_KEY_LABEL).toBe('robota/keyring/v1/sealing-x25519');
    expect(ATTACH_KEY_LABEL).toBe('robota/keyring/v1/attach-ed25519');
    expect(RECOVERY_KEK_LABEL).toBe('robota/keyring/v1/recovery-kek');
    expect(ARTIFACT_KEY_WRAP_LABEL).toBe('robota/keyring/v1/dek-wrap');
  });

  it('derives fixed public keys from a fixed master key', () => {
    const pairs = deriveKeyPairs(FIXED_MASTER_KEY);
    expect(hex(pairs.sealing.publicKey)).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
    expect(hex(pairs.attach.publicKey)).toBe(KNOWN_ATTACH_PUBLIC_KEY_HEX);
    expect(pairs.sealing.privateKey.asymmetricKeyType).toBe('x25519');
    expect(pairs.attach.privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('fingerprints a public key as 80 bits in groups of four', () => {
    const pairs = deriveKeyPairs(FIXED_MASTER_KEY);
    expect(fingerprint(pairs.sealing.publicKey)).toBe('3A2E-D129-B98E-02D9-DF09');
    expect(fingerprint(pairs.attach.publicKey)).toBe('1F1F-6AD4-E8A7-0A15-4249');
  });
});

describe('the checked-in version-1 keyring', () => {
  const keyring = parseKeyring(fixtureText);

  it('still serializes byte for byte as it is stored', () => {
    expect(serializeKeyring(keyring)).toBe(fixtureText.trimEnd());
  });

  it('stores the sealing public key the master key derives', () => {
    expect(hex(getSealingPublicKey(keyring))).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
  });

  it('still unlocks with the passphrase, as typed in a different Unicode form', async () => {
    const unlocked = await unlockWithPassphrase(keyring, FIXTURE_PASSPHRASE_AS_TYPED);
    expect(hex(unlocked.sealing.publicKey)).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
    expect(hex(unlocked.attach.publicKey)).toBe(KNOWN_ATTACH_PUBLIC_KEY_HEX);
    expect(checkSealingPublicKey(keyring, unlocked)).toEqual({ matches: true });
  });

  it('still unlocks with the recovery key', async () => {
    const unlocked = await unlockWithRecoveryKey(keyring, FIXTURE_RECOVERY_KEY);
    expect(hex(unlocked.sealing.publicKey)).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
    expect(hex(unlocked.attach.publicKey)).toBe(KNOWN_ATTACH_PUBLIC_KEY_HEX);
  });
});
