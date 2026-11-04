/**
 * What reading needs, and nothing that proves ownership: the X25519 sealing keypair, which opens
 * sealed artifact keys, and the authorship key, which tags and checks what the owner wrote. An
 * unlock yields exactly this, and so does a read grant on an owner link. Neither carries the master
 * key or the attach keypair, so a holder of read keys can read and vouch but can never prove itself
 * the owner to a verifier, certify a runtime or re-wrap the master key.
 */
import { authorshipTag, verifyAuthorshipTag } from './authorship.js';
import { KeyringError } from './errors.js';
import type { IKeyPair } from './key-pairs.js';

/**
 * `lock()` drops this object's references to the keys, zero-fills the authorship key (plain bytes
 * held only here) and makes every accessor and operation throw `keys-locked`. It does NOT zero the
 * sealing keypair: a `KeyObject` offers no way to overwrite its contents, so the private key stays
 * in memory until the garbage collector frees it, and any reference a caller copied out earlier
 * stays valid. Treat `lock()` as "stop handing out keys", not as erasure.
 */
export interface IReadKeys {
  readonly locked: boolean;
  /** X25519 keypair that opens sealed artifact keys. */
  readonly sealing: IKeyPair;
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

interface IReadKeyMaterial {
  readonly sealing: IKeyPair;
  readonly authorship: Uint8Array;
}

class ReadKeys implements IReadKeys {
  #material: IReadKeyMaterial | undefined;

  constructor(sealing: IKeyPair, authorship: Uint8Array) {
    this.#material = { sealing, authorship };
  }

  get locked(): boolean {
    return this.#material === undefined;
  }

  get sealing(): IKeyPair {
    return this.#require().sealing;
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

  #require(): IReadKeyMaterial {
    if (this.#material === undefined) {
      throw new KeyringError('keys-locked', 'The keys are locked.');
    }
    return this.#material;
  }
}

/** The read keys over `sealing` and `authorship`; the authorship bytes are this object's from now on. */
export function createReadKeys(sealing: IKeyPair, authorship: Uint8Array): IReadKeys {
  return new ReadKeys(sealing, authorship);
}
