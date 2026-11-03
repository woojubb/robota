import { Buffer } from 'node:buffer';

import { fromBase64Url } from './bytes.js';
import { KeyringError } from './errors.js';
import { GCM_IV_BYTES, GCM_TAG_BYTES } from './aead.js';
import { KEY_BYTES, SCRYPT_SALT_BYTES } from './kdf.js';
import {
  KEYRING_VERSION,
  type IKeyring,
  type IPassphraseKeyslot,
  type IRecoveryKeyslot,
  type TKeyslot,
} from './keyring-types.js';

export const SLOT_ID_BYTES = 16;
export const WRAPPED_KEY_BYTES = KEY_BYTES + GCM_TAG_BYTES;
/** A keyring is a few hundred bytes; anything near this size is not one. */
export const MAX_KEYRING_JSON_CHARS = 16 * 1024;
export const MAX_KEYSLOTS = 8;

const KEYRING_KEYS = ['version', 'sealingPublicKey', 'slots'];
const SLOT_COMMON_KEYS = ['id', 'type', 'iv', 'wrappedKey'];
const PASSPHRASE_SLOT_KEYS = [...SLOT_COMMON_KEYS, 'kdf'];
const KDF_KEYS = ['algorithm', 'N', 'r', 'p', 'salt'];

function malformed(detail: string): KeyringError {
  return new KeyringError('malformed-keyring', `The keyring is malformed: ${detail}.`);
}

/** A plain data object (JSON-shaped), not an array, class instance or null-prototype oddity. */
function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed(`${what} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw malformed(`${what} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

/** Exactly the allowed own keys: an unknown key (including `__proto__` as data) is refused. */
function requireExactKeys(record: Record<string, unknown>, allowed: string[], what: string): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw malformed(`${what} must have exactly the fields ${allowed.join(', ')}`);
  }
}

function requireBytes(value: unknown, length: number, what: string): string {
  if (fromBase64Url(value, length) === undefined) {
    throw malformed(`${what} must be canonical base64url of ${length} bytes`);
  }
  return value as string;
}

function requirePositiveInteger(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw malformed(`${what} must be a positive integer`);
  }
  return value;
}

function readPassphraseSlot(record: Record<string, unknown>, what: string): IPassphraseKeyslot {
  requireExactKeys(record, PASSPHRASE_SLOT_KEYS, what);
  const kdf = asRecord(record.kdf, `${what}.kdf`);
  requireExactKeys(kdf, KDF_KEYS, `${what}.kdf`);
  if (kdf.algorithm !== 'scrypt') throw malformed(`${what}.kdf.algorithm must be "scrypt"`);
  // Built field by field in the document's fixed order, so serialization is deterministic.
  return {
    id: requireBytes(record.id, SLOT_ID_BYTES, `${what}.id`),
    type: 'passphrase',
    kdf: Object.freeze({
      algorithm: 'scrypt',
      N: requirePositiveInteger(kdf.N, `${what}.kdf.N`),
      r: requirePositiveInteger(kdf.r, `${what}.kdf.r`),
      p: requirePositiveInteger(kdf.p, `${what}.kdf.p`),
      salt: requireBytes(kdf.salt, SCRYPT_SALT_BYTES, `${what}.kdf.salt`),
    } as const),
    iv: requireBytes(record.iv, GCM_IV_BYTES, `${what}.iv`),
    wrappedKey: requireBytes(record.wrappedKey, WRAPPED_KEY_BYTES, `${what}.wrappedKey`),
  };
}

function readRecoverySlot(record: Record<string, unknown>, what: string): IRecoveryKeyslot {
  requireExactKeys(record, SLOT_COMMON_KEYS, what);
  return {
    id: requireBytes(record.id, SLOT_ID_BYTES, `${what}.id`),
    type: 'recovery',
    iv: requireBytes(record.iv, GCM_IV_BYTES, `${what}.iv`),
    wrappedKey: requireBytes(record.wrappedKey, WRAPPED_KEY_BYTES, `${what}.wrappedKey`),
  };
}

function readSlot(value: unknown, index: number): TKeyslot {
  const what = `slots[${index}]`;
  const record = asRecord(value, what);
  switch (record.type) {
    case 'passphrase':
      return Object.freeze(readPassphraseSlot(record, what));
    case 'recovery':
      return Object.freeze(readRecoverySlot(record, what));
    default:
      // Not "ignore and carry on": dropping an unknown slot on the next write would destroy it.
      throw malformed(`${what}.type is not a known slot type`);
  }
}

/**
 * Validates a version-1 keyring document and returns a fresh, frozen copy built only from
 * validated primitives — nothing from the input object (and nothing from its prototype chain)
 * is carried over. Used by `parseKeyring` and by every operation that accepts a keyring, so a
 * hand-built object gets the same scrutiny as a parsed file.
 */
export function validateKeyring(value: unknown): IKeyring {
  const record = asRecord(value, 'the document');
  // Version first: a future document may legitimately have a different shape.
  if (record.version !== KEYRING_VERSION) {
    if (typeof record.version === 'number' && Number.isSafeInteger(record.version)) {
      throw new KeyringError(
        'unsupported-version',
        'The keyring was written by a version this build does not support.',
      );
    }
    throw malformed('version must be an integer');
  }
  requireExactKeys(record, KEYRING_KEYS, 'the document');
  const sealingPublicKey = requireBytes(record.sealingPublicKey, KEY_BYTES, 'sealingPublicKey');
  if (
    !Array.isArray(record.slots) ||
    record.slots.length < 1 ||
    record.slots.length > MAX_KEYSLOTS
  ) {
    throw malformed(`slots must be an array of 1 to ${MAX_KEYSLOTS} entries`);
  }
  const slots = record.slots.map((slot, index) => readSlot(slot, index));
  if (new Set(slots.map((slot) => slot.id)).size !== slots.length) {
    throw malformed('slot ids must be unique');
  }
  return Object.freeze({
    version: KEYRING_VERSION,
    sealingPublicKey,
    slots: Object.freeze(slots),
  });
}

/** Parses keyring JSON strictly; see {@link validateKeyring}. */
export function parseKeyring(json: string): IKeyring {
  if (typeof json !== 'string') throw malformed('the document must be a JSON string');
  if (json.length > MAX_KEYRING_JSON_CHARS) throw malformed('the document is too large');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw malformed('the document is not valid JSON');
  }
  return validateKeyring(value);
}

/** The keyring as JSON with a fixed field order, ready to write to disk. */
export function serializeKeyring(keyring: IKeyring): string {
  return JSON.stringify(validateKeyring(keyring), null, 2);
}

/** The raw 32-byte sealing public key — all a locked process needs to seal new artifacts. */
export function getSealingPublicKey(keyring: IKeyring): Buffer {
  return Buffer.from(validateKeyring(keyring).sealingPublicKey, 'base64url');
}
