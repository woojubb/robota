import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv } from 'node:crypto';

import { wipe } from './bytes.js';
import { KeyringError } from './errors.js';

export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
const AES_256_GCM = 'aes-256-gcm';

/**
 * AES-256-GCM seal. Returns `ciphertext || tag`. The cipher is AES-GCM everywhere because it is the
 * AEAD both Node and Bun implement (ChaCha20-Poly1305 is not available on Bun).
 */
export function gcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Buffer {
  try {
    const cipher = createCipheriv(AES_256_GCM, key, iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([body, cipher.getAuthTag()]);
  } catch {
    // The inputs are checked before they get here; what is left is a key or IV the cipher refused.
    throw new KeyringError('invalid-argument', 'The key or IV cannot be used for encryption.');
  }
}

/**
 * AES-256-GCM open of `ciphertext || tag`. Plaintext is returned only after the tag verified; any
 * failure — wrong key, wrong AAD, modified or truncated bytes — is one `decryption-failed`.
 */
export function gcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array,
): Buffer {
  if (sealed.length < GCM_TAG_BYTES) {
    throw new KeyringError('decryption-failed', 'Authentication of the ciphertext failed.');
  }
  const bodyLength = sealed.length - GCM_TAG_BYTES;
  const body = sealed.subarray(0, bodyLength);
  const tag = sealed.subarray(bodyLength);
  const parts: Buffer[] = [];
  try {
    const decipher = createDecipheriv(AES_256_GCM, key, iv, { authTagLength: GCM_TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    parts.push(decipher.update(body));
    parts.push(decipher.final());
    return Buffer.concat(parts);
  } catch {
    throw new KeyringError('decryption-failed', 'Authentication of the ciphertext failed.');
  } finally {
    // `update` hands out unauthenticated plaintext before `final` verifies the tag; never keep it.
    wipe(...parts);
  }
}
