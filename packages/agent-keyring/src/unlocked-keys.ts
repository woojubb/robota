import { KeyringError } from './errors.js';
import type { IDerivedKeyPairs, IKeyPair } from './key-pairs.js';

/**
 * The keys an unlocked keyring yields. The master key is never part of this: it is wiped right after
 * the two keypairs are derived.
 *
 * `lock()` drops this object's references to the keys and makes every accessor throw `keys-locked`.
 * It does NOT zero key material: a `KeyObject` offers no way to overwrite its contents, so the
 * private keys stay in memory until the garbage collector frees them, and any reference a caller
 * copied out earlier stays valid. Treat `lock()` as "stop handing out keys", not as erasure.
 */
export interface IUnlockedKeys {
  readonly locked: boolean;
  /** X25519 keypair that opens sealed artifact keys. */
  readonly sealing: IKeyPair;
  /** Ed25519 keypair that proves ownership to a verifier. Its public half is never stored in the keyring file. */
  readonly attach: IKeyPair;
  lock(): void;
}

class UnlockedKeys implements IUnlockedKeys {
  #pairs: IDerivedKeyPairs | undefined;

  constructor(pairs: IDerivedKeyPairs) {
    this.#pairs = pairs;
  }

  get locked(): boolean {
    return this.#pairs === undefined;
  }

  get sealing(): IKeyPair {
    return this.#require().sealing;
  }

  get attach(): IKeyPair {
    return this.#require().attach;
  }

  lock(): void {
    this.#pairs = undefined;
  }

  #require(): IDerivedKeyPairs {
    if (this.#pairs === undefined) {
      throw new KeyringError('keys-locked', 'The keys are locked.');
    }
    return this.#pairs;
  }
}

export function createUnlockedKeys(pairs: IDerivedKeyPairs): IUnlockedKeys {
  return new UnlockedKeys(pairs);
}
