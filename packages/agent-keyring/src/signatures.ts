/**
 * Ed25519 signing and checking, in the one form every link check uses: a check answers yes or no and
 * never throws, so a malformed signature or key from the other end is just a refusal, and a failed
 * signature surfaces as a fixed error that says nothing about the key.
 */
import type { Buffer } from 'node:buffer';
import { sign, verify, type KeyObject } from 'node:crypto';

import { isBytes } from './bytes.js';
import { KeyringError } from './errors.js';
import { ed25519PublicKeyFromRaw } from './key-pairs.js';

/** An Ed25519 signature. */
export const SIGNATURE_BYTES = 64;

/**
 * Ed25519 over `message` (pure Ed25519: the message is signed as it is, with no pre-hash). A host
 * that cannot sign fails as `kdf-failed`, whatever it threw, so nothing about the key surfaces.
 */
export function signEd25519(privateKey: KeyObject, message: Uint8Array): Buffer {
  try {
    return sign(null, message, privateKey);
  } catch {
    throw new KeyringError('kdf-failed', 'The key operation could not run on this host.');
  }
}

/**
 * Whether `signature` is the Ed25519 signature of `message` under the raw 32-byte `publicKey`. A
 * signature of another length, a public key that is not one, or a host that refuses the check are
 * all simply "not a valid signature": a verifier decides on this answer alone.
 */
export function verifyEd25519(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (!isBytes(signature) || signature.length !== SIGNATURE_BYTES || !isBytes(message))
    return false;
  try {
    return verify(null, message, ed25519PublicKeyFromRaw(publicKey), signature);
  } catch {
    return false;
  }
}
