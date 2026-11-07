import { Buffer } from 'node:buffer';
import { diffieHellman, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

import { gcmDecrypt, gcmEncrypt, GCM_IV_BYTES, GCM_TAG_BYTES } from './aead.js';
import { concatLengthPrefixed, isBytes, wipe } from './bytes.js';
import { KeyringError } from './errors.js';
import { rawPublicKey, x25519PublicKeyFromRaw } from './key-pairs.js';
import { hkdf32, KEY_BYTES } from './kdf.js';

/** The first byte of every sealed key, record and blob. Authenticated, so it cannot be downgraded. */
export const SEALED_FORMAT_VERSION = 1;

/** `info` of the HKDF that turns the ECDH secret into the key that wraps an artifact key. */
export const ARTIFACT_KEY_WRAP_LABEL = 'robota/keyring/v1/dek-wrap';

const VERSION_BYTES = 1;
/** version | ephemeral X25519 public key | IV | wrapped key + tag */
export const SEALED_KEY_BYTES =
  VERSION_BYTES + KEY_BYTES + GCM_IV_BYTES + KEY_BYTES + GCM_TAG_BYTES;
/** version | nonce | tag, around the ciphertext */
export const RECORD_OVERHEAD_BYTES = VERSION_BYTES + GCM_IV_BYTES + GCM_TAG_BYTES;

function requireBytes(value: unknown, what: string, length?: number): Uint8Array {
  if (!isBytes(value) || (length !== undefined && value.length !== length)) {
    throw new KeyringError(
      'invalid-argument',
      length === undefined
        ? `The ${what} must be a Uint8Array.`
        : `The ${what} must be a Uint8Array of exactly ${length} bytes.`,
    );
  }
  return value;
}

function requireSealingPrivateKey(value: unknown): KeyObject {
  const key = value as KeyObject | undefined;
  if (
    typeof key !== 'object' ||
    key === null ||
    key.type !== 'private' ||
    key.asymmetricKeyType !== 'x25519'
  ) {
    throw new KeyringError(
      'invalid-argument',
      'The sealing private key must be an X25519 private KeyObject.',
    );
  }
  return key;
}

/** The AAD the AEAD actually authenticates: the format version plus the caller's context. */
function boundAad(callerAad: unknown): Buffer {
  return concatLengthPrefixed([
    Buffer.from([SEALED_FORMAT_VERSION]),
    requireBytes(callerAad, 'aad'),
  ]);
}

/**
 * Both ends of the ECDH mix both public keys into the HKDF salt, so the wrapping key is bound to
 * this exact sender/recipient pair and not only to the shared secret.
 */
function deriveWrapKey(
  sharedSecret: Buffer,
  ephemeralPublicKey: Uint8Array,
  recipientPublicKey: Uint8Array,
): Buffer {
  const salt = Buffer.concat([ephemeralPublicKey, recipientPublicKey]);
  try {
    return hkdf32(sharedSecret, ARTIFACT_KEY_WRAP_LABEL, salt);
  } finally {
    wipe(sharedSecret);
  }
}

/** A fresh ephemeral X25519 keypair; a host that cannot make one fails as `kdf-failed`. */
function generateEphemeralKeyPair(): {
  readonly privateKey: KeyObject;
  readonly publicKey: Buffer;
} {
  try {
    const ephemeral = generateKeyPairSync('x25519');
    return { privateKey: ephemeral.privateKey, publicKey: rawPublicKey(ephemeral.publicKey) };
  } catch {
    throw new KeyringError('kdf-failed', 'The key derivation could not run on this host.');
  }
}

/** A fresh random 256-bit data-encryption key (DEK) for one artifact. The caller wipes it after use. */
export function generateArtifactKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Seals `artifactKey` to the sealing PUBLIC key (ECIES: fresh ephemeral X25519 key, ECDH, HKDF-SHA256,
 * AES-256-GCM). Only the public key is needed, so a process that never unlocked the keyring can
 * still produce artifacts that only the owner can open. Every call uses a new ephemeral key and IV,
 * so sealing the same key twice yields different bytes.
 *
 * `aad` is authenticated, not stored: the caller must present the same bytes to open it. Put the
 * artifact id in it, so a sealed key cannot be moved to another artifact.
 */
export function sealArtifactKey(
  sealingPublicKey: Uint8Array,
  artifactKey: Uint8Array,
  aad: Uint8Array,
): Buffer {
  const recipientRaw = requireBytes(sealingPublicKey, 'sealing public key', KEY_BYTES);
  requireBytes(artifactKey, 'artifact key', KEY_BYTES);
  const bound = boundAad(aad);
  const recipient = x25519PublicKeyFromRaw(recipientRaw);
  const ephemeral = generateEphemeralKeyPair();
  const ephemeralPublic = ephemeral.publicKey;
  let sharedSecret: Buffer;
  try {
    sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  } catch {
    // A low-order point (for example an all-zero key written into the file) has no usable secret.
    throw new KeyringError(
      'invalid-argument',
      'The sealing public key cannot be used for key agreement.',
    );
  }
  const wrapKey = deriveWrapKey(sharedSecret, ephemeralPublic, recipientRaw);
  try {
    const iv = randomBytes(GCM_IV_BYTES);
    const wrapped = gcmEncrypt(wrapKey, iv, artifactKey, bound);
    return Buffer.concat([Buffer.from([SEALED_FORMAT_VERSION]), ephemeralPublic, iv, wrapped]);
  } finally {
    wipe(wrapKey);
  }
}

function requireSealedVersion(bytes: Uint8Array): void {
  if (bytes.length === 0) {
    throw new KeyringError('malformed-ciphertext', 'The sealed data is empty.');
  }
  if (bytes[0] !== SEALED_FORMAT_VERSION) {
    throw new KeyringError(
      'unsupported-version',
      'The sealed data uses a format this build does not support.',
    );
  }
}

/**
 * Opens a key produced by {@link sealArtifactKey}. Needs the unlocked sealing private key. The
 * caller owns and wipes the returned key.
 */
export function openArtifactKey(
  sealingPrivateKey: KeyObject,
  sealed: Uint8Array,
  aad: Uint8Array,
): Buffer {
  const privateKey = requireSealingPrivateKey(sealingPrivateKey);
  requireBytes(sealed, 'sealed key');
  const bound = boundAad(aad);
  requireSealedVersion(sealed);
  if (sealed.length !== SEALED_KEY_BYTES) {
    throw new KeyringError('malformed-ciphertext', 'The sealed key has the wrong length.');
  }
  const ephemeralPublic = sealed.subarray(VERSION_BYTES, VERSION_BYTES + KEY_BYTES);
  const ivStart = VERSION_BYTES + KEY_BYTES;
  const iv = sealed.subarray(ivStart, ivStart + GCM_IV_BYTES);
  const wrapped = sealed.subarray(ivStart + GCM_IV_BYTES);
  let sharedSecret: Buffer;
  try {
    sharedSecret = diffieHellman({
      privateKey,
      publicKey: x25519PublicKeyFromRaw(ephemeralPublic),
    });
  } catch {
    throw new KeyringError('decryption-failed', 'Authentication of the ciphertext failed.');
  }
  const wrapKey = deriveWrapKey(sharedSecret, ephemeralPublic, rawPublicKey(privateKey));
  try {
    return gcmDecrypt(wrapKey, iv, wrapped, bound);
  } finally {
    wipe(wrapKey);
  }
}

/**
 * One content record: `version | 12-byte random nonce | ciphertext | 16-byte tag`, AES-256-GCM
 * under the artifact key. Use it as often as needed with one key — a JSONL log appends one record
 * per batch of lines, a whole-file blob is one record — but keep a key's record count far below
 * 2^32, the safe limit for random 96-bit nonces.
 *
 * `aad` is authenticated, not stored. Put the artifact id and the record's sequence number in it:
 * that is what stops records from being swapped between files or reordered. Detecting that
 * TRAILING records were cut off is not something one record can know — a log truncated at a record
 * boundary is a valid log — so the caller must keep the expected record count (or a final marker
 * record) somewhere it trusts.
 */
export function encryptRecord(
  artifactKey: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Buffer {
  requireBytes(artifactKey, 'artifact key', KEY_BYTES);
  requireBytes(plaintext, 'plaintext');
  const bound = boundAad(aad);
  const nonce = randomBytes(GCM_IV_BYTES);
  const sealed = gcmEncrypt(artifactKey, nonce, plaintext, bound);
  return Buffer.concat([Buffer.from([SEALED_FORMAT_VERSION]), nonce, sealed]);
}

/** Opens a record from {@link encryptRecord}; returns plaintext only if the whole record authenticates. */
export function decryptRecord(
  artifactKey: Uint8Array,
  record: Uint8Array,
  aad: Uint8Array,
): Buffer {
  requireBytes(artifactKey, 'artifact key', KEY_BYTES);
  requireBytes(record, 'record');
  const bound = boundAad(aad);
  requireSealedVersion(record);
  if (record.length < RECORD_OVERHEAD_BYTES) {
    throw new KeyringError(
      'malformed-ciphertext',
      'The record is shorter than its fixed overhead.',
    );
  }
  const nonceEnd = VERSION_BYTES + GCM_IV_BYTES;
  return gcmDecrypt(
    artifactKey,
    record.subarray(VERSION_BYTES, nonceEnd),
    record.subarray(nonceEnd),
    bound,
  );
}

/**
 * Seals a whole value in one step: a sealed key header followed by one record under that key.
 * Like {@link sealArtifactKey} it needs only the sealing public key.
 */
export function sealBlob(
  sealingPublicKey: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Buffer {
  const artifactKey = generateArtifactKey();
  try {
    return Buffer.concat([
      sealArtifactKey(sealingPublicKey, artifactKey, aad),
      encryptRecord(artifactKey, plaintext, aad),
    ]);
  } finally {
    wipe(artifactKey);
  }
}

/**
 * The two halves of a blob from {@link sealBlob}: the sealed key and the one record under it, as
 * views into `blob`. A holder that keeps opened keys by sealed key splits with this, so the blob
 * layout stays in this package. Checks the layout only; nothing is authenticated until each half is
 * opened.
 */
export function splitSealedBlob(blob: Uint8Array): {
  readonly sealedKey: Uint8Array;
  readonly record: Uint8Array;
} {
  requireBytes(blob, 'blob');
  requireSealedVersion(blob);
  if (blob.length < SEALED_KEY_BYTES + RECORD_OVERHEAD_BYTES) {
    throw new KeyringError('malformed-ciphertext', 'The blob is shorter than its fixed overhead.');
  }
  return { sealedKey: blob.subarray(0, SEALED_KEY_BYTES), record: blob.subarray(SEALED_KEY_BYTES) };
}

/** Opens a blob from {@link sealBlob}; any truncation, extension or edit fails as a whole. */
export function openBlob(sealingPrivateKey: KeyObject, blob: Uint8Array, aad: Uint8Array): Buffer {
  requireSealingPrivateKey(sealingPrivateKey);
  const { sealedKey, record } = splitSealedBlob(blob);
  const artifactKey = openArtifactKey(sealingPrivateKey, sealedKey, aad);
  try {
    return decryptRecord(artifactKey, record, aad);
  } finally {
    wipe(artifactKey);
  }
}
