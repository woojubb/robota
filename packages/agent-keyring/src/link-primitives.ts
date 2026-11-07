/**
 * The few operations the spawner exchange and the handshake are built from, each in the one form
 * they use it: a key agreement that refuses a point with no usable secret, transcript hashing and
 * MACs over length-prefixed parts, and HKDF to any length. Each wraps a `node:crypto` primitive the
 * keyring already uses, so the link adds nothing a supported runtime lacks.
 */
import { Buffer } from 'node:buffer';
import {
  createHash,
  createHmac,
  diffieHellman,
  hkdfSync,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';

import { concatLengthPrefixed, isBytes, wipe } from './bytes.js';
import { KeyringError, LinkRefusedError } from './errors.js';
import { x25519KeyPairFromSeed, x25519PublicKeyFromRaw, type IKeyPair } from './key-pairs.js';
import { KEY_BYTES } from './kdf.js';
import type { ILinkEntropy } from './link-entropy.js';

/** A fresh X25519 keypair from the entropy's seed; the seed is wiped once the pair exists. */
export function ephemeralKeyPair(entropy: ILinkEntropy): IKeyPair {
  const seed = entropy.seed();
  try {
    return x25519KeyPairFromSeed(seed);
  } finally {
    wipe(seed);
  }
}

/**
 * The X25519 shared secret with the peer's raw public key. A value that is not a 32-byte key, or a
 * low-order point with no usable secret, is the peer's malformed message: refused, never retried.
 */
export function agree(privateKey: KeyObject, peerPublicKey: Uint8Array): Buffer {
  if (!isBytes(peerPublicKey) || peerPublicKey.length !== KEY_BYTES) {
    throw new LinkRefusedError('malformed');
  }
  try {
    return diffieHellman({ privateKey, publicKey: x25519PublicKeyFromRaw(peerPublicKey) });
  } catch {
    throw new LinkRefusedError('malformed');
  }
}

/** SHA-256 over length-prefixed parts, so no two part lists hash alike. */
export function hashParts(parts: readonly Uint8Array[]): Buffer {
  return createHash('sha256').update(concatLengthPrefixed(parts)).digest();
}

/** HMAC-SHA256 of the concatenation of `parts` under `key`. */
export function hmac(key: Uint8Array, ...parts: readonly Uint8Array[]): Buffer {
  const mac = createHmac('sha256', key);
  for (const part of parts) mac.update(part);
  return mac.digest();
}

/** Whether two byte strings are equal, in constant time once their (public) lengths match. */
export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/** HKDF-SHA256 to `length` bytes; a host that cannot run it fails as `kdf-failed`. */
export function hkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number,
): Buffer {
  try {
    return Buffer.from(hkdfSync('sha256', inputKeyMaterial, salt, info, length));
  } catch {
    throw new KeyringError('kdf-failed', 'The key derivation could not run on this host.');
  }
}
