import { authorshipTag, verifyAuthorshipTag } from './authorship.js';
import { KeyringError } from './errors.js';
import type { IDerivedKeyPairs, IKeyPair } from './key-pairs.js';

/**
 * The keys an unlocked keyring yields. The master key is never part of this: it is wiped right after
 * the two keypairs and the authorship key are derived.
 *
 * `lock()` drops this object's references to the keys, zero-fills the authorship key (plain bytes
 * held only here) and makes every accessor and operation throw `keys-locked`. It does NOT zero the
 * keypairs: a `KeyObject` offers no way to overwrite its contents, so the private keys stay in memory
 * until the garbage collector frees them, and any reference a caller copied out earlier stays valid.
 * Treat `lock()` as "stop handing out keys", not as erasure.
 */
export interface IUnlockedKeys {
  readonly locked: boolean;
  /** X25519 keypair that opens sealed artifact keys. */
  readonly sealing: IKeyPair;
  /** Ed25519 keypair that proves ownership to a verifier. Its public half is never stored in the keyring file. */
  readonly attach: IKeyPair;
  /**
   * The HMAC-SHA256 tag of `message` under the authorship key, which has no public half: what an
   * unlocked process attaches to what it wrote, since a sealed artifact opens for whoever sealed it.
   * The key itself is never handed out.
   */
  tagAuthorship(message: Uint8Array): Uint8Array;
  /** Whether `tag` is {@link tagAuthorship} of `message`, compared in constant time. */
  verifyAuthorship(message: Uint8Array, tag: Uint8Array): boolean;
  lock(): void;
}

interface IUnlockedKeyMaterial {
  readonly pairs: IDerivedKeyPairs;
  readonly authorship: Uint8Array;
}

class UnlockedKeys implements IUnlockedKeys {
  #material: IUnlockedKeyMaterial | undefined;

  constructor(pairs: IDerivedKeyPairs, authorship: Uint8Array) {
    this.#material = { pairs, authorship };
  }

  get locked(): boolean {
    return this.#material === undefined;
  }

  get sealing(): IKeyPair {
    return this.#require().pairs.sealing;
  }

  get attach(): IKeyPair {
    return this.#require().pairs.attach;
  }

  tagAuthorship(message: Uint8Array): Uint8Array {
    return authorshipTag(this.#require().authorship, message);
  }

  verifyAuthorship(message: Uint8Array, tag: Uint8Array): boolean {
    return verifyAuthorshipTag(this.#require().authorship, message, tag);
  }

  lock(): void {
    this.#material?.authorship.fill(0);
    this.#material = undefined;
  }

  #require(): IUnlockedKeyMaterial {
    if (this.#material === undefined) {
      throw new KeyringError('keys-locked', 'The keys are locked.');
    }
    return this.#material;
  }
}

/** The unlocked keys over `pairs` and `authorship`; the authorship bytes are this object's from now on. */
export function createUnlockedKeys(pairs: IDerivedKeyPairs, authorship: Uint8Array): IUnlockedKeys {
  return new UnlockedKeys(pairs, authorship);
}
