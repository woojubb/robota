/**
 * The owner, present for a moment.
 *
 * Reading needs only the read keys; proving ownership needs the attach key, and that is the one key
 * a runtime must never hold, since whoever holds it can certify impostors and present as the owner to
 * any runtime. So the attach key has one home: a handover, opened from the keyring with a credential
 * a person just typed, held for the seconds a command needs it, and disposed. A handover hands out
 * operations and public values, never a key. Certifying a runtime instance is its one public
 * operation; signing an owner proof and sealing a read grant happen inside the link initiator,
 * through an accessor this package does not export.
 */
import type { Buffer } from 'node:buffer';

import { deriveAuthorshipKey } from './authorship.js';
import { wipe } from './bytes.js';
import { KeyringError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import {
  deriveAttachKeyPair,
  deriveSealingSeed,
  x25519KeyPairFromSeed,
  type IKeyPair,
} from './key-pairs.js';
import { validateKeyring } from './keyring-document.js';
import { recoverMasterKey, sealingPublicKeyMatches, type TKeyringCredential } from './keyring.js';
import type { IKeyring } from './keyring-types.js';
import {
  runtimeCertificateMessage,
  type ILinkBinding,
  type ITrustRoot,
} from './runtime-certificate.js';
import { signEd25519 } from './signatures.js';

export interface IOwnerHandover {
  /**
   * Whether the keyring file holds the sealing public key the credential derives. `false` means the
   * file was altered: a runtime given these keys seals to the derived key, and the file is repaired
   * by `secure verify`, not here.
   */
  readonly sealingKeyMatches: boolean;
  /** The derived sealing public key's fingerprint, shown so a replaced keyring file is noticed. */
  readonly fingerprint: string;
  readonly disposed: boolean;
  /**
   * The trust root that tells a runtime its owner: the attach public key and the certificate of
   * `instancePublicKey` for `binding`. Give it only for an instance key and binding learned over an
   * authenticated link, since the certificate vouches for exactly them.
   */
  certify(instancePublicKey: Uint8Array, binding: ILinkBinding): ITrustRoot;
  /** Zero-fills what it can and drops every key; later calls throw `keys-locked`. Idempotent. */
  dispose(): void;
}

/** What only the link initiator reaches: everything an owner proof and a read grant are made of. */
export interface IOwnerHandoverSecrets {
  readonly attach: IKeyPair;
  /** The 32-byte seed of the sealing keypair: what a read grant carries, since it rebuilds the pair. */
  readonly sealingSeed: Buffer;
  readonly sealingPublicKey: Uint8Array;
  readonly authorship: Buffer;
}

const SECRETS = new WeakMap<IOwnerHandover, () => IOwnerHandoverSecrets>();

class OwnerHandover implements IOwnerHandover {
  #secrets: IOwnerHandoverSecrets | undefined;
  readonly #sealingKeyMatches: boolean;

  constructor(secrets: IOwnerHandoverSecrets, sealingKeyMatches: boolean) {
    this.#secrets = secrets;
    this.#sealingKeyMatches = sealingKeyMatches;
    SECRETS.set(this, () => this.#require());
  }

  get sealingKeyMatches(): boolean {
    this.#require();
    return this.#sealingKeyMatches;
  }

  get fingerprint(): string {
    return fingerprint(this.#require().sealingPublicKey);
  }

  get disposed(): boolean {
    return this.#secrets === undefined;
  }

  certify(instancePublicKey: Uint8Array, binding: ILinkBinding): ITrustRoot {
    const { attach } = this.#require();
    const message = runtimeCertificateMessage(instancePublicKey, binding);
    return {
      attachPublicKey: Uint8Array.from(attach.publicKey),
      certificate: Uint8Array.from(signEd25519(attach.privateKey, message)),
    };
  }

  dispose(): void {
    const secrets = this.#secrets;
    if (secrets === undefined) return;
    this.#secrets = undefined;
    wipe(secrets.sealingSeed, secrets.authorship);
  }

  #require(): IOwnerHandoverSecrets {
    if (this.#secrets === undefined) {
      throw new KeyringError('keys-locked', 'The owner handover was disposed.');
    }
    return this.#secrets;
  }
}

/**
 * Package-private: the owner's keys behind a handover, for the link initiator alone. It is not
 * exported from the entry point, and it answers only for a handover this package opened.
 */
export function ownerHandoverSecrets(handover: IOwnerHandover): IOwnerHandoverSecrets {
  const secrets = SECRETS.get(handover);
  if (secrets === undefined) {
    throw new KeyringError(
      'invalid-argument',
      'This is not an owner handover this package opened.',
    );
  }
  return secrets();
}

/**
 * Opens the owner handover with `credential`: one key derivation (one scrypt run per passphrase
 * slot, as an unlock), from whose master key the attach keypair and the read keys are derived; the
 * master key is zero-filled before this returns. A wrong credential and a tampered slot fail alike.
 */
export async function openOwnerHandover(
  keyring: IKeyring,
  credential: TKeyringCredential,
): Promise<IOwnerHandover> {
  const document = validateKeyring(keyring);
  const { masterKey } = await recoverMasterKey(document, credential);
  let sealingSeed: Buffer | undefined;
  let authorship: Buffer | undefined;
  try {
    sealingSeed = deriveSealingSeed(masterKey);
    authorship = deriveAuthorshipKey(masterKey);
    const attach = deriveAttachKeyPair(masterKey);
    const sealingPublicKey = x25519KeyPairFromSeed(sealingSeed).publicKey;
    return new OwnerHandover(
      { attach, sealingSeed, sealingPublicKey, authorship },
      sealingPublicKeyMatches(document, sealingPublicKey),
    );
  } catch (error) {
    wipe(sealingSeed, authorship);
    throw error;
  } finally {
    wipe(masterKey);
  }
}
