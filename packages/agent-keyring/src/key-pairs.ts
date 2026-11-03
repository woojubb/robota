import { Buffer } from 'node:buffer';
import { createPrivateKey, createPublicKey, randomBytes, type KeyObject } from 'node:crypto';

import { isBytes, wipe } from './bytes.js';
import { KeyringError } from './errors.js';
import { hkdf32, KEY_BYTES } from './kdf.js';

/**
 * The HKDF `info` labels. They are versioned and part of the on-disk contract: changing a byte
 * changes every derived key, so the known-answer tests pin the public keys they produce.
 */
export const SEALING_KEY_LABEL = 'robota/keyring/v1/sealing-x25519';
export const ATTACH_KEY_LABEL = 'robota/keyring/v1/attach-ed25519';

// `node:crypto` has no "private key from raw seed" import that Bun and Node both accept, so the raw
// 32-byte seed is wrapped in the fixed PKCS#8 / SPKI headers of RFC 8410.
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const SPKI_PREFIX_BYTES = SPKI_X25519_PREFIX.length;

export interface IKeyPair {
  /** The raw 32-byte public key. */
  readonly publicKey: Uint8Array;
  readonly privateKey: KeyObject;
}

export interface IDerivedKeyPairs {
  readonly sealing: IKeyPair;
  readonly attach: IKeyPair;
}

/** The raw 32-byte public key of an X25519 or Ed25519 key object. */
export function rawPublicKey(key: KeyObject): Buffer {
  try {
    const spki = (key.type === 'public' ? key : createPublicKey(key)).export({
      format: 'der',
      type: 'spki',
    });
    return Buffer.from(spki.subarray(SPKI_PREFIX_BYTES));
  } catch {
    throw new KeyringError('invalid-argument', 'The key has no exportable public key.');
  }
}

/** An X25519 public key object from its raw 32 bytes, from any realm (see `isBytes`). */
export function x25519PublicKeyFromRaw(raw: Uint8Array): KeyObject {
  if (!isBytes(raw) || raw.length !== KEY_BYTES) {
    throw new KeyringError('invalid-argument', 'A public key must be exactly 32 bytes.');
  }
  try {
    return createPublicKey({
      key: Buffer.concat([SPKI_X25519_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    throw new KeyringError('invalid-argument', 'The public key is not a valid X25519 key.');
  }
}

/** A keypair from a derived seed; a host that cannot build one fails as `kdf-failed`, whatever it threw. */
function keyPairFromSeed(prefix: Buffer, seed: Buffer): IKeyPair {
  const pkcs8 = Buffer.concat([prefix, seed]);
  try {
    const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    return { publicKey: rawPublicKey(privateKey), privateKey };
  } catch {
    throw new KeyringError('kdf-failed', 'The key derivation could not run on this host.');
  } finally {
    wipe(pkcs8);
  }
}

/**
 * Derives the two long-lived keypairs from the master key: an X25519 sealing keypair and an Ed25519
 * attach keypair, each from its own HKDF-SHA256 seed (empty salt, versioned `info` label), so
 * neither key says anything about the other.
 */
export function deriveKeyPairs(masterKey: Uint8Array): IDerivedKeyPairs {
  const sealingSeed = hkdf32(masterKey, SEALING_KEY_LABEL);
  const attachSeed = hkdf32(masterKey, ATTACH_KEY_LABEL);
  try {
    return {
      sealing: keyPairFromSeed(PKCS8_X25519_PREFIX, sealingSeed),
      attach: keyPairFromSeed(PKCS8_ED25519_PREFIX, attachSeed),
    };
  } finally {
    wipe(sealingSeed, attachSeed);
  }
}

/**
 * A new X25519 sealing keypair from a random seed, for a key that lives only in the memory of the
 * process that made it: nothing derives it again, so whatever is sealed to it opens only while that
 * process keeps the private key. Built from the seed as the derived pairs are, so it has their shape
 * on every runtime.
 */
export function generateTransientSealingKeyPair(): IKeyPair {
  const seed = randomBytes(KEY_BYTES);
  try {
    return keyPairFromSeed(PKCS8_X25519_PREFIX, seed);
  } finally {
    wipe(seed);
  }
}
