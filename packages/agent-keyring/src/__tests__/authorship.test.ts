/**
 * The authorship key: what only an unlocked keyring can do, since sealing needs only the public key
 * and so proves nothing about who wrote an artifact. A tag made under it verifies only for the exact
 * message it was made for, and the unlocked keys stop tagging and verifying once they are locked.
 */
import { describe, expect, it } from 'vitest';

import { createKeyring, unlockWithRecoveryKey } from '../index.js';
import { authorshipTag, deriveAuthorshipKey, verifyAuthorshipTag } from '../authorship.js';
import { FIXED_MASTER_KEY, bytesOf, codeOf, tamper } from './helpers.js';

const message = bytesOf('robota/authorship/v1|session-record|sess_a|digest');

describe('authorship tags', () => {
  it('verify for the message they were made for, and for nothing else', () => {
    const key = deriveAuthorshipKey(FIXED_MASTER_KEY);
    const tag = authorshipTag(key, message);

    expect(tag).toHaveLength(32);
    expect(verifyAuthorshipTag(key, message, tag)).toBe(true);
    expect(
      verifyAuthorshipTag(key, bytesOf('robota/authorship/v1|session-record|sess_b|digest'), tag),
    ).toBe(false);
    expect(verifyAuthorshipTag(key, message, tamper(tag, 31))).toBe(false);
    expect(verifyAuthorshipTag(key, message, tag.subarray(0, 31))).toBe(false);
    expect(verifyAuthorshipTag(key, message, new Uint8Array(0))).toBe(false);
  });

  it('do not verify under another master key', () => {
    const other = deriveAuthorshipKey(tamper(FIXED_MASTER_KEY, 0));
    const tag = authorshipTag(deriveAuthorshipKey(FIXED_MASTER_KEY), message);
    expect(verifyAuthorshipTag(other, message, tag)).toBe(false);
  });

  it('refuse a value that is not bytes as a caller bug', () => {
    const key = deriveAuthorshipKey(FIXED_MASTER_KEY);
    expect(codeOf(() => authorshipTag(key, 'text' as unknown as Uint8Array))).toBe(
      'invalid-argument',
    );
    expect(codeOf(() => verifyAuthorshipTag(key, message, 'tag' as unknown as Uint8Array))).toBe(
      'invalid-argument',
    );
  });
});

describe('the unlocked keys', () => {
  it('tag and verify with the key the master key derives, from creation on', async () => {
    const { keyring, recoveryKey, unlocked } = await createKeyring({ passphrase: 'a passphrase' });
    const tag = unlocked.tagAuthorship(message);

    expect(unlocked.verifyAuthorship(message, tag)).toBe(true);
    const again = await unlockWithRecoveryKey(keyring, recoveryKey);
    expect(again.verifyAuthorship(message, tag)).toBe(true);
    expect(Buffer.from(again.tagAuthorship(message)).equals(Buffer.from(tag))).toBe(true);
  });

  it('stop tagging and verifying once locked', async () => {
    const { unlocked } = await createKeyring({ passphrase: 'a passphrase' });
    const tag = unlocked.tagAuthorship(message);
    unlocked.lock();

    expect(codeOf(() => unlocked.tagAuthorship(message))).toBe('keys-locked');
    expect(codeOf(() => unlocked.verifyAuthorship(message, tag))).toBe('keys-locked');
  });
});
