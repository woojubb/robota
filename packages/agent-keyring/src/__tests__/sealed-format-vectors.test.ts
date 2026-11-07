/**
 * Known-answer vectors for the three sealed wire formats: a sealed artifact key, a content record
 * and a blob, each sealed to the sealing public key of FIXED_MASTER_KEY under a fixed AAD.
 *
 * Sealing draws a fresh ephemeral key, IV and nonce every time, so the vectors cannot be recomputed;
 * they were produced once with `sealArtifactKey`, `encryptRecord` and `sealBlob` from this package
 * (run under tsx against `src/`) and checked in. What they pin is that bytes written by that build
 * still open, to the same plaintext, in this one: a change to the framing, the labels, the AAD
 * binding or the key derivation fails here even though every round trip still passes.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decryptRecord, openArtifactKey, openBlob, splitSealedBlob } from '../index.js';
import { deriveKeyPairs } from '../key-pairs.js';
import { codeOf, FIXED_MASTER_KEY, hex, tamper } from './helpers.js';

interface ISealedVectors {
  readonly aad: string;
  readonly plaintext: string;
  readonly artifactKey: string;
  readonly sealedKey: string;
  readonly record: string;
  readonly blob: string;
}

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sealed-v1.json', import.meta.url)), 'utf8'),
) as ISealedVectors;
const bytes = (field: string): Buffer => Buffer.from(field, 'hex');
const owner = deriveKeyPairs(FIXED_MASTER_KEY);
const aad = bytes(vectors.aad);

describe('sealed format version 1 — known answers', () => {
  it('opens the checked-in sealed artifact key to the known key', () => {
    expect(hex(openArtifactKey(owner.sealing.privateKey, bytes(vectors.sealedKey), aad))).toBe(
      vectors.artifactKey,
    );
  });

  it('opens the checked-in record to the known plaintext', () => {
    expect(hex(decryptRecord(bytes(vectors.artifactKey), bytes(vectors.record), aad))).toBe(
      vectors.plaintext,
    );
  });

  it('opens the checked-in blob to the known plaintext', () => {
    expect(hex(openBlob(owner.sealing.privateKey, bytes(vectors.blob), aad))).toBe(
      vectors.plaintext,
    );
  });

  it('splits the checked-in blob into a sealed key and a record that open separately', () => {
    const { sealedKey, record } = splitSealedBlob(bytes(vectors.blob));
    const artifactKey = openArtifactKey(owner.sealing.privateKey, sealedKey, aad);
    expect(hex(decryptRecord(artifactKey, record, aad))).toBe(vectors.plaintext);
  });

  it('refuses each of them with one byte changed, and under a different AAD', () => {
    const sealedKey = bytes(vectors.sealedKey);
    const record = bytes(vectors.record);
    const blob = bytes(vectors.blob);
    const key = bytes(vectors.artifactKey);
    const otherAad = tamper(aad, 0);
    for (const index of [1, 40, sealedKey.length - 1]) {
      expect(
        codeOf(() => openArtifactKey(owner.sealing.privateKey, tamper(sealedKey, index), aad)),
      ).toBe('decryption-failed');
    }
    for (const index of [1, 20, record.length - 1]) {
      expect(codeOf(() => decryptRecord(key, tamper(record, index), aad))).toBe(
        'decryption-failed',
      );
    }
    for (const index of [1, 100, blob.length - 1]) {
      expect(codeOf(() => openBlob(owner.sealing.privateKey, tamper(blob, index), aad))).toBe(
        'decryption-failed',
      );
    }
    expect(codeOf(() => openArtifactKey(owner.sealing.privateKey, sealedKey, otherAad))).toBe(
      'decryption-failed',
    );
    expect(codeOf(() => decryptRecord(key, record, otherAad))).toBe('decryption-failed');
    expect(codeOf(() => openBlob(owner.sealing.privateKey, blob, otherAad))).toBe(
      'decryption-failed',
    );
  });
});
