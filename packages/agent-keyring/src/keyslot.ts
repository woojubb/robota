import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { gcmDecrypt, gcmEncrypt, GCM_IV_BYTES } from './aead.js';
import { concatLengthPrefixed, decodeKeyringField, toBase64Url, utf8 } from './bytes.js';
import { KeyringError } from './errors.js';
import { hkdf32 } from './kdf.js';
import { SLOT_ID_BYTES, WRAPPED_KEY_BYTES } from './keyring-document.js';
import { KEYRING_VERSION, type TKeyslot, type TKeyslotType } from './keyring-types.js';

/** `info` of the recovery slot's key-encryption key. Versioned like every other HKDF label. */
export const RECOVERY_KEK_LABEL = 'robota/keyring/v1/recovery-kek';

export function newSlotId(): string {
  return toBase64Url(randomBytes(SLOT_ID_BYTES));
}

/**
 * The key-encryption key of a recovery slot. The recovery key is 160 random bits, so HKDF is all it
 * needs; stretching it with scrypt would add cost and no strength.
 */
export function deriveRecoveryKek(recoveryKeyBytes: Uint8Array): Buffer {
  return hkdf32(recoveryKeyBytes, RECOVERY_KEK_LABEL);
}

/**
 * What the wrapping authenticates: version, slot id and slot type. A slot that is relabelled,
 * re-identified or moved to a document of another version stops unwrapping. The sealing public key
 * is deliberately NOT bound: the product detects a swapped public key at unlock and repairs it, and
 * a binding would turn that repairable tamper into a lockout.
 */
export function keyslotAad(slotId: string, slotType: TKeyslotType): Buffer {
  return concatLengthPrefixed([Buffer.from([KEYRING_VERSION]), utf8(slotId), utf8(slotType)]);
}

export interface IWrappedMasterKey {
  readonly iv: string;
  readonly wrappedKey: string;
}

/** AES-256-GCM wrap of the master key under `kek` with a fresh random 12-byte IV. */
export function wrapMasterKey(
  kek: Uint8Array,
  masterKey: Uint8Array,
  slotId: string,
  slotType: TKeyslotType,
): IWrappedMasterKey {
  const iv = randomBytes(GCM_IV_BYTES);
  const wrapped = gcmEncrypt(kek, iv, masterKey, keyslotAad(slotId, slotType));
  return { iv: toBase64Url(iv), wrappedKey: toBase64Url(wrapped) };
}

/**
 * Unwraps the master key of `slot` with `kek`. Any failure to authenticate is `wrong-credential`:
 * a wrong passphrase, a wrong recovery key and a tampered slot cannot be told apart, and the
 * caller must not be able to either. The caller owns (and wipes) `kek` and the returned key.
 */
export function unwrapMasterKey(kek: Uint8Array, slot: TKeyslot): Buffer {
  const iv = decodeKeyringField(slot.iv, GCM_IV_BYTES);
  const wrapped = decodeKeyringField(slot.wrappedKey, WRAPPED_KEY_BYTES);
  try {
    return gcmDecrypt(kek, iv, wrapped, keyslotAad(slot.id, slot.type));
  } catch {
    throw new KeyringError('wrong-credential', 'The credential did not open the keyring.');
  }
}
