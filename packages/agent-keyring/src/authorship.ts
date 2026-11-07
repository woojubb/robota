import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { isBytes } from './bytes.js';
import { KeyringError } from './errors.js';
import { hkdf32 } from './kdf.js';

/**
 * The HKDF `info` label of the authorship key, versioned and part of the on-disk contract like the
 * keypairs' labels: a tag written under one label never verifies under another.
 */
export const AUTHORSHIP_KEY_LABEL = 'robota/keyring/v1/authorship-hmac';

/** An HMAC-SHA256 tag. */
export const AUTHORSHIP_TAG_BYTES = 32;

/**
 * The authorship key: an HMAC-SHA256 key from its own HKDF-SHA256 label (empty salt), so it says
 * nothing about the keypairs and they say nothing about it. Unlike the sealing key it has no public
 * half, so only a process that recovered the master key can make a tag that verifies.
 */
export function deriveAuthorshipKey(masterKey: Uint8Array): Buffer {
  return hkdf32(masterKey, AUTHORSHIP_KEY_LABEL);
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** HMAC-SHA256 of `message` under `key`; a non-byte argument is a caller bug (`invalid-argument`). */
export function authorshipTag(key: Uint8Array, message: Uint8Array): Buffer {
  if (!isBytes(key) || !isBytes(message)) {
    throw new KeyringError('invalid-argument', 'An authorship tag is made over bytes.');
  }
  try {
    return createHmac('sha256', asBuffer(key)).update(asBuffer(message)).digest();
  } catch {
    throw new KeyringError('invalid-argument', 'The authorship tag could not be computed.');
  }
}

/**
 * Whether `tag` is the authorship tag of `message` under `key`, compared in constant time. A tag of
 * another length is simply not one (the length is public), so it is refused before any comparison.
 */
export function verifyAuthorshipTag(
  key: Uint8Array,
  message: Uint8Array,
  tag: Uint8Array,
): boolean {
  if (!isBytes(tag)) {
    throw new KeyringError('invalid-argument', 'An authorship tag is bytes.');
  }
  const expected = authorshipTag(key, message);
  try {
    if (tag.length !== expected.length) return false;
    return timingSafeEqual(expected, asBuffer(tag));
  } finally {
    expected.fill(0);
  }
}
