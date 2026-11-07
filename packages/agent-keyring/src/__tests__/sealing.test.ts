import { Buffer } from 'node:buffer';
import { createPublicKey, randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  KeyringError,
  decryptRecord,
  encryptRecord,
  generateArtifactKey,
  openArtifactKey,
  openBlob,
  sealArtifactKey,
  sealBlob,
  splitSealedBlob,
} from '../index.js';
import { deriveKeyPairs } from '../key-pairs.js';
import { RECORD_OVERHEAD_BYTES, SEALED_KEY_BYTES } from '../sealing.js';
import { bytesOf, codeOf, FIXED_MASTER_KEY, hex, tamper } from './helpers.js';

const owner = deriveKeyPairs(FIXED_MASTER_KEY);
const stranger = deriveKeyPairs(Buffer.alloc(32, 7));
// A locked process holds only this: 32 public bytes.
const sealingPublicKey = new Uint8Array(owner.sealing.publicKey);
const aad = bytesOf('artifact:7f3a|seq:0');
const plaintext = bytesOf('{"role":"user","text":"the launch code is 0000"}\n');

describe('sealed artifact keys', () => {
  it('seals with only the public key and opens only with the matching private key', () => {
    const artifactKey = generateArtifactKey();
    expect(artifactKey).toHaveLength(32);

    const sealed = sealArtifactKey(sealingPublicKey, artifactKey, aad);
    expect(sealed).toHaveLength(SEALED_KEY_BYTES);
    expect(sealed[0]).toBe(1);
    expect(hex(openArtifactKey(owner.sealing.privateKey, sealed, aad))).toBe(hex(artifactKey));

    // The key material never appears in the sealed bytes.
    expect(Buffer.from(sealed).includes(artifactKey)).toBe(false);

    expect(codeOf(() => openArtifactKey(stranger.sealing.privateKey, sealed, aad))).toBe(
      'decryption-failed',
    );
  });

  it('refuses a key that is not the X25519 sealing private key', () => {
    const sealed = sealArtifactKey(sealingPublicKey, generateArtifactKey(), aad);
    // The attach key is Ed25519; a public key object cannot open anything.
    expect(codeOf(() => openArtifactKey(owner.attach.privateKey, sealed, aad))).toBe(
      'invalid-argument',
    );
    const publicOnly = createPublicKey(owner.sealing.privateKey);
    expect(codeOf(() => openArtifactKey(publicOnly, sealed, aad))).toBe('invalid-argument');
    expect(codeOf(() => openArtifactKey(undefined as never, sealed, aad))).toBe('invalid-argument');
  });

  it('is randomized: sealing the same key twice differs everywhere that matters', () => {
    const artifactKey = generateArtifactKey();
    const first = sealArtifactKey(sealingPublicKey, artifactKey, aad);
    const second = sealArtifactKey(sealingPublicKey, artifactKey, aad);
    expect(first.equals(second)).toBe(false);
    expect(first.subarray(1, 33).equals(second.subarray(1, 33))).toBe(false); // ephemeral key
    expect(first.subarray(33, 45).equals(second.subarray(33, 45))).toBe(false); // IV
  });

  it('binds the AAD', () => {
    const sealed = sealArtifactKey(sealingPublicKey, generateArtifactKey(), aad);
    expect(
      codeOf(() => openArtifactKey(owner.sealing.privateKey, sealed, bytesOf('artifact:other'))),
    ).toBe('decryption-failed');
    expect(codeOf(() => openArtifactKey(owner.sealing.privateKey, sealed, new Uint8Array(0)))).toBe(
      'decryption-failed',
    );
  });

  it('fails on a change to any single byte, and never returns a key', () => {
    const sealed = sealArtifactKey(sealingPublicKey, generateArtifactKey(), aad);
    for (let index = 0; index < sealed.length; index += 1) {
      const expected = index === 0 ? 'unsupported-version' : 'decryption-failed';
      expect(
        codeOf(() => openArtifactKey(owner.sealing.privateKey, tamper(sealed, index), aad)),
      ).toBe(expected);
    }
  });

  it('authenticates the ephemeral key even where X25519 ignores a bit of it', () => {
    // RFC 7748 masks the top bit of the u-coordinate, so flipping it leaves the ECDH secret
    // unchanged. The sender's key is also mixed into the HKDF salt, so it is still caught.
    const sealed = sealArtifactKey(sealingPublicKey, generateArtifactKey(), aad);
    expect(
      codeOf(() => openArtifactKey(owner.sealing.privateKey, tamper(sealed, 32, 0x80), aad)),
    ).toBe('decryption-failed');
  });

  it('fails on truncated or extended sealed keys', () => {
    const sealed = sealArtifactKey(sealingPublicKey, generateArtifactKey(), aad);
    expect(
      codeOf(() => openArtifactKey(owner.sealing.privateKey, sealed.subarray(0, 92), aad)),
    ).toBe('malformed-ciphertext');
    expect(
      codeOf(() => openArtifactKey(owner.sealing.privateKey, sealed.subarray(0, 1), aad)),
    ).toBe('malformed-ciphertext');
    expect(
      codeOf(() =>
        openArtifactKey(owner.sealing.privateKey, Buffer.concat([sealed, Buffer.alloc(1)]), aad),
      ),
    ).toBe('malformed-ciphertext');
    expect(codeOf(() => openArtifactKey(owner.sealing.privateKey, new Uint8Array(0), aad))).toBe(
      'malformed-ciphertext',
    );
  });

  it('rejects arguments of the wrong type or size', () => {
    const artifactKey = generateArtifactKey();
    expect(codeOf(() => sealArtifactKey(sealingPublicKey.subarray(1), artifactKey, aad))).toBe(
      'invalid-argument',
    );
    expect(codeOf(() => sealArtifactKey(sealingPublicKey, artifactKey.subarray(1), aad))).toBe(
      'invalid-argument',
    );
    expect(codeOf(() => sealArtifactKey(sealingPublicKey, artifactKey, 'text' as never))).toBe(
      'invalid-argument',
    );
    expect(
      codeOf(() => sealArtifactKey(sealingPublicKey, artifactKey, new Uint8Array(65_536))),
    ).toBe('invalid-argument');
  });

  it('refuses a sealing public key that has no usable ECDH secret', () => {
    // An all-zero key is a low-order point: the shared secret would be all zeros for any sender.
    expect(codeOf(() => sealArtifactKey(new Uint8Array(32), generateArtifactKey(), aad))).toBe(
      'invalid-argument',
    );
  });
});

describe('content records', () => {
  const artifactKey = generateArtifactKey();

  it('round-trips and has the documented layout', () => {
    const record = encryptRecord(artifactKey, plaintext, aad);
    expect(record).toHaveLength(RECORD_OVERHEAD_BYTES + plaintext.length);
    expect(record[0]).toBe(1);
    expect(hex(decryptRecord(artifactKey, record, aad))).toBe(hex(plaintext));
    expect(record.includes(plaintext)).toBe(false);
  });

  it('round-trips empty and large plaintexts', () => {
    const empty = encryptRecord(artifactKey, new Uint8Array(0), aad);
    expect(empty).toHaveLength(RECORD_OVERHEAD_BYTES);
    expect(decryptRecord(artifactKey, empty, aad)).toHaveLength(0);

    const large = randomBytes(1024 * 1024);
    expect(hex(decryptRecord(artifactKey, encryptRecord(artifactKey, large, aad), aad))).toBe(
      hex(large),
    );
  });

  it('uses a fresh nonce for every record under one key', () => {
    const nonces = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      nonces.add(hex(encryptRecord(artifactKey, plaintext, aad).subarray(1, 13)));
    }
    expect(nonces.size).toBe(500);
  });

  it('binds the AAD, so a record cannot move to another artifact or sequence number', () => {
    const record = encryptRecord(artifactKey, plaintext, bytesOf('artifact:7f3a|seq:1'));
    expect(codeOf(() => decryptRecord(artifactKey, record, bytesOf('artifact:7f3a|seq:2')))).toBe(
      'decryption-failed',
    );
    expect(codeOf(() => decryptRecord(artifactKey, record, bytesOf('artifact:9999|seq:1')))).toBe(
      'decryption-failed',
    );
    expect(hex(decryptRecord(artifactKey, record, bytesOf('artifact:7f3a|seq:1')))).toBe(
      hex(plaintext),
    );
  });

  it('fails under another key', () => {
    const record = encryptRecord(artifactKey, plaintext, aad);
    expect(codeOf(() => decryptRecord(generateArtifactKey(), record, aad))).toBe(
      'decryption-failed',
    );
  });

  it('fails on a change to any single byte', () => {
    const record = encryptRecord(artifactKey, plaintext, aad);
    for (let index = 0; index < record.length; index += 1) {
      const expected = index === 0 ? 'unsupported-version' : 'decryption-failed';
      expect(codeOf(() => decryptRecord(artifactKey, tamper(record, index), aad))).toBe(expected);
    }
  });

  it('fails on truncated or extended records', () => {
    const record = encryptRecord(artifactKey, plaintext, aad);
    expect(codeOf(() => decryptRecord(artifactKey, record.subarray(0, 5), aad))).toBe(
      'malformed-ciphertext',
    );
    expect(
      codeOf(() => decryptRecord(artifactKey, record.subarray(0, RECORD_OVERHEAD_BYTES - 1), aad)),
    ).toBe('malformed-ciphertext');
    expect(codeOf(() => decryptRecord(artifactKey, new Uint8Array(0), aad))).toBe(
      'malformed-ciphertext',
    );
    expect(
      codeOf(() => decryptRecord(artifactKey, record.subarray(0, record.length - 1), aad)),
    ).toBe('decryption-failed');
    expect(codeOf(() => decryptRecord(artifactKey, record.subarray(1), aad))).toBe(
      'unsupported-version',
    );
    expect(
      codeOf(() => decryptRecord(artifactKey, Buffer.concat([record, Buffer.alloc(1)]), aad)),
    ).toBe('decryption-failed');
  });

  it('reports an unknown version byte as unsupported, not as tampering', () => {
    const record = encryptRecord(artifactKey, plaintext, aad);
    expect(codeOf(() => decryptRecord(artifactKey, tamper(record, 0, 0x02), aad))).toBe(
      'unsupported-version',
    );
  });

  it('rejects a key or record of the wrong type or size', () => {
    expect(codeOf(() => encryptRecord(artifactKey.subarray(1), plaintext, aad))).toBe(
      'invalid-argument',
    );
    expect(codeOf(() => encryptRecord(artifactKey, 'text' as never, aad))).toBe('invalid-argument');
    expect(codeOf(() => decryptRecord(artifactKey, 'text' as never, aad))).toBe('invalid-argument');
  });

  it('does not reveal that two records hold the same plaintext', () => {
    // 4 KiB of zeros sealed twice: the two ciphertexts must look independent. Each ciphertext is
    // ~half ones, and they differ in ~half their bits (18 standard deviations of slack).
    const zeros = new Uint8Array(4096);
    const first = encryptRecord(artifactKey, zeros, aad).subarray(13, 13 + 4096);
    const second = encryptRecord(artifactKey, zeros, aad).subarray(13, 13 + 4096);
    const bits = (bytes: Uint8Array) =>
      bytes.reduce((total, byte) => total + byte.toString(2).replaceAll('0', '').length, 0);
    const totalBits = 4096 * 8;
    expect(bits(first) / totalBits).toBeGreaterThan(0.45);
    expect(bits(first) / totalBits).toBeLessThan(0.55);
    const differing = bits(first.map((byte, index) => byte ^ second[index]));
    expect(differing / totalBits).toBeGreaterThan(0.45);
    expect(differing / totalBits).toBeLessThan(0.55);
  });
});

describe('sealed blobs', () => {
  it('seals with only the public key and opens with the private key', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    expect(blob).toHaveLength(SEALED_KEY_BYTES + RECORD_OVERHEAD_BYTES + plaintext.length);
    expect(blob.includes(plaintext)).toBe(false);
    expect(hex(openBlob(owner.sealing.privateKey, blob, aad))).toBe(hex(plaintext));
    expect(codeOf(() => openBlob(stranger.sealing.privateKey, blob, aad))).toBe(
      'decryption-failed',
    );
    expect(codeOf(() => openBlob(owner.attach.privateKey, blob, aad))).toBe('invalid-argument');
  });

  it('seals the same plaintext to different blobs', () => {
    const blobs = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      blobs.add(hex(sealBlob(sealingPublicKey, plaintext, aad)));
    }
    expect(blobs.size).toBe(100);
  });

  it('binds the AAD', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    expect(codeOf(() => openBlob(owner.sealing.privateKey, blob, bytesOf('artifact:other')))).toBe(
      'decryption-failed',
    );
  });

  it('fails on a change to any single byte, never returning plaintext', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    for (let index = 0; index < blob.length; index += 1) {
      // Two version bytes: the sealed key header's and the record's.
      const isVersionByte = index === 0 || index === SEALED_KEY_BYTES;
      const expected = isVersionByte ? 'unsupported-version' : 'decryption-failed';
      expect(codeOf(() => openBlob(owner.sealing.privateKey, tamper(blob, index), aad))).toBe(
        expected,
      );
    }
  });

  it('fails on truncated or extended blobs', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    expect(codeOf(() => openBlob(owner.sealing.privateKey, blob.subarray(0, 50), aad))).toBe(
      'malformed-ciphertext',
    );
    expect(
      codeOf(() => openBlob(owner.sealing.privateKey, blob.subarray(0, SEALED_KEY_BYTES), aad)),
    ).toBe('malformed-ciphertext');
    expect(codeOf(() => openBlob(owner.sealing.privateKey, new Uint8Array(0), aad))).toBe(
      'malformed-ciphertext',
    );
    for (const cut of [1, 5, 16, 17, plaintext.length]) {
      expect(
        codeOf(() => openBlob(owner.sealing.privateKey, blob.subarray(0, blob.length - cut), aad)),
      ).toBe('decryption-failed');
    }
    expect(
      codeOf(() => openBlob(owner.sealing.privateKey, Buffer.concat([blob, Buffer.alloc(1)]), aad)),
    ).toBe('decryption-failed');
    expect(codeOf(() => openBlob(owner.sealing.privateKey, Buffer.concat([blob, blob]), aad))).toBe(
      'decryption-failed',
    );
  });
});

describe('splitting a sealed blob', () => {
  it('yields the sealed key and the record, each of which opens on its own', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    const { sealedKey, record } = splitSealedBlob(blob);
    expect(sealedKey).toHaveLength(SEALED_KEY_BYTES);
    expect(record).toHaveLength(RECORD_OVERHEAD_BYTES + plaintext.length);
    expect(hex(Buffer.concat([sealedKey, record]))).toBe(hex(blob));
    const artifactKey = openArtifactKey(owner.sealing.privateKey, sealedKey, aad);
    expect(hex(decryptRecord(artifactKey, record, aad))).toBe(hex(plaintext));
  });

  it('splits a blob of the smallest possible size', () => {
    const blob = sealBlob(sealingPublicKey, new Uint8Array(0), aad);
    expect(splitSealedBlob(blob).record).toHaveLength(RECORD_OVERHEAD_BYTES);
  });

  it('refuses a blob shorter than its fixed overhead, and an unknown version, as openBlob does', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    for (const short of [
      new Uint8Array(0),
      blob.subarray(0, 50),
      blob.subarray(0, SEALED_KEY_BYTES),
      blob.subarray(0, SEALED_KEY_BYTES + RECORD_OVERHEAD_BYTES - 1),
    ]) {
      expect(codeOf(() => splitSealedBlob(short))).toBe('malformed-ciphertext');
    }
    expect(codeOf(() => splitSealedBlob(tamper(blob, 0)))).toBe('unsupported-version');
    expect(codeOf(() => splitSealedBlob('blob' as never))).toBe('invalid-argument');
  });

  it('carries no part of the blob in its errors', () => {
    const blob = sealBlob(sealingPublicKey, plaintext, aad);
    for (const bad of [blob.subarray(0, 50), tamper(blob, 0)]) {
      let refusal: unknown;
      try {
        splitSealedBlob(bad);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(KeyringError);
      const text = `${(refusal as Error).message} ${JSON.stringify(refusal)}`;
      expect(text).not.toContain(hex(bad.subarray(1, 9)));
      expect(text).not.toContain(Buffer.from(bad.subarray(1, 9)).toString('base64'));
    }
  });
});

describe('byte arrays from another realm', () => {
  /** A copy of `bytes` whose Uint8Array constructor is another realm's, as a worker or vm context hands over. */
  function foreign(bytes: Uint8Array): Uint8Array {
    const copy = runInNewContext(`new Uint8Array(${bytes.length})`) as Uint8Array;
    copy.set(bytes);
    expect(copy instanceof Uint8Array).toBe(false);
    return copy;
  }

  it('seals to a foreign-realm public key and opens a foreign-realm blob', () => {
    const blob = sealBlob(foreign(sealingPublicKey), plaintext, foreign(aad));
    expect(hex(openBlob(owner.sealing.privateKey, foreign(blob), foreign(aad)))).toBe(
      hex(plaintext),
    );
  });
});
