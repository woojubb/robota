/** The only keyring document version this build reads and writes. */
export const KEYRING_VERSION = 1;

/**
 * How a passphrase slot stretches the passphrase. All fields are stored in the slot so a keyring
 * written at one cost still unlocks after the default cost changes.
 */
export interface IScryptKdfParameters {
  readonly algorithm: 'scrypt';
  readonly N: number;
  readonly r: number;
  readonly p: number;
  /** base64url, 16 bytes. */
  readonly salt: string;
}

interface IKeyslotBase {
  /** base64url, 16 random bytes; bound into the wrapping AAD. */
  readonly id: string;
  /** base64url, 12 bytes. */
  readonly iv: string;
  /** base64url, the AES-256-GCM-wrapped master key plus its 16-byte tag (48 bytes). */
  readonly wrappedKey: string;
}

export interface IPassphraseKeyslot extends IKeyslotBase {
  readonly type: 'passphrase';
  readonly kdf: IScryptKdfParameters;
}

export interface IRecoveryKeyslot extends IKeyslotBase {
  readonly type: 'recovery';
}

/**
 * A keyslot is a tagged union on `type`: a future way to unlock (a device secret, for example) adds
 * a member here and a branch in the parser, without touching the existing slots.
 */
export type TKeyslot = IPassphraseKeyslot | IRecoveryKeyslot;
export type TKeyslotType = TKeyslot['type'];

/**
 * The persisted keyring document. There is deliberately no field for the attach public key: the
 * file lets anyone seal to the owner, but nothing in it lets a program claim to be the owner.
 */
export interface IKeyring {
  readonly version: typeof KEYRING_VERSION;
  /** base64url, the raw 32-byte X25519 sealing public key. */
  readonly sealingPublicKey: string;
  readonly slots: readonly TKeyslot[];
}
