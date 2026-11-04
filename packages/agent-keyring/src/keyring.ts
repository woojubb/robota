import type { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { deriveAuthorshipKey } from './authorship.js';
import { decodeKeyringField, toBase64Url, wipe } from './bytes.js';
import { KeyringError } from './errors.js';
import { deriveKeyPairs, type IDerivedKeyPairs } from './key-pairs.js';
import {
  assertScryptParametersInBounds,
  DEFAULT_SCRYPT_PARAMETERS,
  deriveKeyFromPassphrase,
  KEY_BYTES,
  normalizePassphrase,
  SCRYPT_SALT_BYTES,
} from './kdf.js';
import { getSealingPublicKey, validateKeyring } from './keyring-document.js';
import {
  KEYRING_VERSION,
  type IKeyring,
  type IPassphraseKeyslot,
  type IRecoveryKeyslot,
  type TKeyslot,
} from './keyring-types.js';
import { deriveRecoveryKek, newSlotId, unwrapMasterKey, wrapMasterKey } from './keyslot.js';
import { formatRecoveryKey, parseRecoveryKey, RECOVERY_KEY_BYTES } from './recovery-key.js';
import { createUnlockedKeys, type IUnlockedKeys } from './unlocked-keys.js';

/** What proves the right to open a keyring. A tagged union so a future credential is one more member. */
export type TKeyringCredential =
  | { readonly type: 'passphrase'; readonly passphrase: string }
  | { readonly type: 'recoveryKey'; readonly recoveryKey: string };

export interface ICreateKeyringOptions {
  /** Any non-empty string; minimum length and strength are the caller's policy. */
  readonly passphrase: string;
}

export interface ICreatedKeyring {
  readonly keyring: IKeyring;
  /**
   * The recovery key, formatted for a person to write down. It exists only here: it is not stored
   * anywhere and cannot be shown again, so the caller must present it exactly once.
   */
  readonly recoveryKey: string;
  readonly unlocked: IUnlockedKeys;
}

export interface IAssembleKeyringInput {
  readonly masterKey: Uint8Array;
  /** Normalized passphrase bytes (see `normalizePassphrase`). */
  readonly passphrase: Uint8Array;
  readonly recoveryKeyBytes: Uint8Array;
}

function isPassphraseSlot(slot: TKeyslot): slot is IPassphraseKeyslot {
  return slot.type === 'passphrase';
}

function isRecoverySlot(slot: TKeyslot): slot is IRecoveryKeyslot {
  return slot.type === 'recovery';
}

async function makePassphraseSlot(
  masterKey: Uint8Array,
  passphrase: Uint8Array,
  slotId: string,
): Promise<IPassphraseKeyslot> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const kek = await deriveKeyFromPassphrase(passphrase, salt, DEFAULT_SCRYPT_PARAMETERS);
  try {
    const wrapped = wrapMasterKey(kek, masterKey, slotId, 'passphrase');
    return {
      id: slotId,
      type: 'passphrase',
      kdf: { algorithm: 'scrypt', ...DEFAULT_SCRYPT_PARAMETERS, salt: toBase64Url(salt) },
      ...wrapped,
    };
  } finally {
    wipe(kek);
  }
}

function makeRecoverySlot(masterKey: Uint8Array, recoveryKeyBytes: Uint8Array): IRecoveryKeyslot {
  const slotId = newSlotId();
  const kek = deriveRecoveryKek(recoveryKeyBytes);
  try {
    return { id: slotId, type: 'recovery', ...wrapMasterKey(kek, masterKey, slotId, 'recovery') };
  } finally {
    wipe(kek);
  }
}

/**
 * Wraps `masterKey` into a fresh keyring with one passphrase slot and one recovery slot. Exposed to
 * the package's own tests (a fixed master key makes the known-answer vectors possible); it is not
 * part of the public entry point, whose only way to make a keyring draws the master key at random.
 */
export async function assembleKeyring(
  input: IAssembleKeyringInput,
): Promise<{ keyring: IKeyring; pairs: IDerivedKeyPairs }> {
  const pairs = deriveKeyPairs(input.masterKey);
  const passphraseSlot = await makePassphraseSlot(input.masterKey, input.passphrase, newSlotId());
  const recoverySlot = makeRecoverySlot(input.masterKey, input.recoveryKeyBytes);
  const keyring = validateKeyring({
    version: KEYRING_VERSION,
    sealingPublicKey: toBase64Url(pairs.sealing.publicKey),
    slots: [passphraseSlot, recoverySlot],
  });
  return { keyring, pairs };
}

/**
 * Creates a keyring around a new random 256-bit master key, protected by the passphrase and by a
 * new recovery key, and returns it already unlocked. The master key is wiped before this returns.
 */
export async function createKeyring(options: ICreateKeyringOptions): Promise<ICreatedKeyring> {
  const passphrase = normalizePassphrase(options.passphrase);
  const masterKey = randomBytes(KEY_BYTES);
  const recoveryKeyBytes = randomBytes(RECOVERY_KEY_BYTES);
  try {
    const { keyring, pairs } = await assembleKeyring({ masterKey, passphrase, recoveryKeyBytes });
    return {
      keyring,
      recoveryKey: formatRecoveryKey(recoveryKeyBytes),
      unlocked: createUnlockedKeys(pairs, deriveAuthorshipKey(masterKey)),
    };
  } finally {
    wipe(passphrase, masterKey, recoveryKeyBytes);
  }
}

interface IRecoveredMasterKey {
  readonly masterKey: Buffer;
  readonly slotId: string;
}

function isWrongCredential(error: unknown): boolean {
  return error instanceof KeyringError && error.code === 'wrong-credential';
}

async function recoverWithPassphrase(
  keyring: IKeyring,
  passphraseText: unknown,
): Promise<IRecoveredMasterKey> {
  const passphrase = normalizePassphrase(passphraseText);
  try {
    const slots = keyring.slots.filter(isPassphraseSlot);
    if (slots.length === 0) {
      throw new KeyringError('slot-not-found', 'The keyring has no passphrase slot.');
    }
    // Every slot's cost is checked before the first derivation, so a hostile keyring cannot make
    // an earlier, in-range slot burn CPU on the way to a refusal.
    for (const slot of slots) assertScryptParametersInBounds(slot.kdf);
    for (const slot of slots) {
      const salt = decodeKeyringField(slot.kdf.salt, SCRYPT_SALT_BYTES);
      const kek = await deriveKeyFromPassphrase(passphrase, salt, slot.kdf);
      try {
        return { masterKey: unwrapMasterKey(kek, slot), slotId: slot.id };
      } catch (error) {
        if (!isWrongCredential(error)) throw error;
      } finally {
        wipe(kek);
      }
    }
    throw new KeyringError('wrong-credential', 'The credential did not open the keyring.');
  } finally {
    wipe(passphrase);
  }
}

function recoverWithRecoveryKey(keyring: IKeyring, recoveryKeyText: unknown): IRecoveredMasterKey {
  const recoveryKeyBytes = parseRecoveryKey(recoveryKeyText);
  try {
    const slots = keyring.slots.filter(isRecoverySlot);
    if (slots.length === 0) {
      throw new KeyringError('slot-not-found', 'The keyring has no recovery slot.');
    }
    for (const slot of slots) {
      const kek = deriveRecoveryKek(recoveryKeyBytes);
      try {
        return { masterKey: unwrapMasterKey(kek, slot), slotId: slot.id };
      } catch (error) {
        if (!isWrongCredential(error)) throw error;
      } finally {
        wipe(kek);
      }
    }
    throw new KeyringError('wrong-credential', 'The credential did not open the keyring.');
  } finally {
    wipe(recoveryKeyBytes);
  }
}

async function recoverMasterKey(
  keyring: IKeyring,
  credential: TKeyringCredential,
): Promise<IRecoveredMasterKey> {
  switch (credential?.type) {
    case 'passphrase':
      return recoverWithPassphrase(keyring, credential.passphrase);
    case 'recoveryKey':
      return recoverWithRecoveryKey(keyring, credential.recoveryKey);
    default:
      throw new KeyringError('invalid-argument', 'The credential type is not recognised.');
  }
}

async function unlock(keyring: IKeyring, credential: TKeyringCredential): Promise<IUnlockedKeys> {
  const document = validateKeyring(keyring);
  const { masterKey } = await recoverMasterKey(document, credential);
  try {
    return createUnlockedKeys(deriveKeyPairs(masterKey), deriveAuthorshipKey(masterKey));
  } finally {
    wipe(masterKey);
  }
}

/**
 * Unlocks with the passphrase. Costs one scrypt run per passphrase slot (~160 ms at the default
 * cost, off the event loop). The stored sealing public key is NOT consulted — see
 * {@link checkSealingPublicKey}.
 */
export function unlockWithPassphrase(
  keyring: IKeyring,
  passphrase: string,
): Promise<IUnlockedKeys> {
  return unlock(keyring, { type: 'passphrase', passphrase });
}

/** Unlocks with the recovery key shown at creation (case-insensitive, hyphens optional). */
export function unlockWithRecoveryKey(
  keyring: IKeyring,
  recoveryKey: string,
): Promise<IUnlockedKeys> {
  return unlock(keyring, { type: 'recoveryKey', recoveryKey });
}

/**
 * Replaces the passphrase slot with one that wraps the same master key under `newPassphrase`, and
 * returns the new keyring; the input is untouched. Everything encrypted under the keys stays
 * readable because the master key does not change. The caller must prove the right to change it by
 * supplying a working credential — the current passphrase, or the recovery key to reset a forgotten
 * one. The new slot is written at the current default scrypt cost with a fresh salt and IV, and
 * keeps the old slot's id. The stored sealing public key and the recovery slot are carried over
 * as they are.
 */
export async function changePassphrase(
  keyring: IKeyring,
  credential: TKeyringCredential,
  newPassphrase: string,
): Promise<IKeyring> {
  const document = validateKeyring(keyring);
  const replacement = normalizePassphrase(newPassphrase);
  let recovered: IRecoveredMasterKey | undefined;
  try {
    recovered = await recoverMasterKey(document, credential);
    const targetId =
      credential.type === 'passphrase'
        ? recovered.slotId
        : document.slots.find(isPassphraseSlot)?.id;
    if (targetId === undefined) {
      throw new KeyringError('slot-not-found', 'The keyring has no passphrase slot.');
    }
    const slot = await makePassphraseSlot(recovered.masterKey, replacement, targetId);
    return validateKeyring({
      ...document,
      slots: document.slots.map((existing) => (existing.id === targetId ? slot : existing)),
    });
  } finally {
    wipe(replacement, recovered?.masterKey);
  }
}

/**
 * Whether the sealing public key stored in the keyring is the one the master key derives. A
 * mismatch means the file was altered (an attacker who can write it could substitute their own key
 * so new artifacts are sealed to them); the stored key cannot be authenticated without the master
 * key, so this check is only possible after an unlock.
 */
export function checkSealingPublicKey(
  keyring: IKeyring,
  unlocked: IUnlockedKeys,
): { matches: boolean } {
  const stored = getSealingPublicKey(keyring);
  const derived = unlocked.sealing.publicKey;
  return { matches: stored.length === derived.length && timingSafeEqual(stored, derived) };
}

/** A copy of the keyring whose stored sealing public key is the one derived from the unlocked keys. */
export function repairSealingPublicKey(keyring: IKeyring, unlocked: IUnlockedKeys): IKeyring {
  return validateKeyring({
    ...validateKeyring(keyring),
    sealingPublicKey: toBase64Url(unlocked.sealing.publicKey),
  });
}
