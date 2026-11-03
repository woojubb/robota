import { Buffer } from 'node:buffer';
import { createPublicKey } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generateTransientSealingKeyPair, openBlob, sealBlob } from '../index.js';
import { rawPublicKey } from '../key-pairs.js';
import { bytesOf, codeOf, hex } from './helpers.js';

const aad = bytesOf('robota/artifact/v1|tool-result-spill|token');
const plaintext = bytesOf('a tool result only this process reads back');

describe('a transient sealing keypair', () => {
  it('is an X25519 pair whose public half is the one its private key has', () => {
    const pair = generateTransientSealingKeyPair();
    expect(pair.privateKey.type).toBe('private');
    expect(pair.privateKey.asymmetricKeyType).toBe('x25519');
    expect(pair.publicKey).toHaveLength(32);
    expect(hex(pair.publicKey)).toBe(hex(rawPublicKey(createPublicKey(pair.privateKey))));
  });

  it('opens what is sealed to its public key, and nothing sealed to another pair', () => {
    const pair = generateTransientSealingKeyPair();
    const other = generateTransientSealingKeyPair();
    const blob = sealBlob(pair.publicKey, plaintext, aad);
    expect(Buffer.from(openBlob(pair.privateKey, blob, aad)).equals(plaintext)).toBe(true);
    expect(codeOf(() => openBlob(other.privateKey, blob, aad))).toBe('decryption-failed');
  });

  it('is new every time: no two calls give the same key', () => {
    const keys = new Set(
      Array.from({ length: 8 }, () => hex(generateTransientSealingKeyPair().publicKey)),
    );
    expect(keys.size).toBe(8);
  });
});
