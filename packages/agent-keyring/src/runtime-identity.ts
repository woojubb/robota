/**
 * A runtime's identity on the owner link: the crypto state a served runtime holds, and nothing else.
 *
 * - An Ed25519 instance key made at start, in memory only, so no file or other process can stand in
 *   for this runtime; its public half is what the owner certifies.
 * - The spawner key from the one exchange over the inherited pair: spawner standing, until the trust
 *   root is installed.
 * - The trust root, once its spawner installed it: the owner's attach public key and the certificate
 *   of this instance for this runtime start. From then on spawner standing is gone for good, and only
 *   a client that proves the attach key is admitted.
 *
 * Installing a root checks that it certifies this instance for the given binding, under the attach
 * key it names; which link may install it, and when, is the runtime custody's decision.
 */
import type { Buffer } from 'node:buffer';

import { isBytes, wipe } from './bytes.js';
import { KeyringError, LinkRefusedError } from './errors.js';
import { ed25519KeyPairFromSeed, type IKeyPair } from './key-pairs.js';
import { KEY_BYTES } from './kdf.js';
import { SYSTEM_LINK_ENTROPY, type ILinkEntropy } from './link-entropy.js';
import {
  certifies,
  checkLinkBinding,
  type ILinkBinding,
  type ITrustRoot,
} from './runtime-certificate.js';
import { SIGNATURE_BYTES } from './signatures.js';
import { answerSpawnerExchange } from './spawner-exchange.js';

export interface IRuntimeIdentity {
  /** The instance public key, the value the owner certifies. */
  readonly instancePublicKey: Uint8Array;
  /** Whether the spawner exchange ran and its key is still held. */
  readonly spawnerKeyHeld: boolean;
  /** Whether a trust root is installed. */
  readonly certified: boolean;
  /**
   * Answers the spawner's first message with this runtime's ephemeral and instance public key, and
   * keeps the spawner key. Once: a second call is refused, even after a refused first one.
   */
  answerSpawnerExchange(message: Uint8Array): Uint8Array;
  /**
   * Keeps `root` when it certifies this instance for `binding`, and forgets the spawner key. Once,
   * and only while the spawner key is held. A refused root changes nothing.
   */
  installTrustRoot(root: ITrustRoot, binding: ILinkBinding): void;
}

/** The root a runtime was certified with, and the binding it certifies. */
export interface IRuntimeTrust {
  readonly root: ITrustRoot;
  readonly binding: ILinkBinding;
}

/** What only the link responder reaches. */
export interface IRuntimeIdentitySecrets {
  readonly instance: IKeyPair;
  /** Where the responder draws its ephemerals and nonces: the identity's own source. */
  readonly entropy: ILinkEntropy;
  spawnerKey(): Buffer | undefined;
  trust(): IRuntimeTrust | undefined;
}

const SECRETS = new WeakMap<IRuntimeIdentity, IRuntimeIdentitySecrets>();

function checkTrustRoot(value: unknown): ITrustRoot {
  const root = value as Partial<ITrustRoot> | null;
  if (
    typeof root !== 'object' ||
    root === null ||
    !isBytes(root.attachPublicKey) ||
    root.attachPublicKey.length !== KEY_BYTES ||
    !isBytes(root.certificate) ||
    root.certificate.length !== SIGNATURE_BYTES
  ) {
    throw new KeyringError(
      'invalid-argument',
      'A trust root is a 32-byte attach public key and a 64-byte certificate.',
    );
  }
  return {
    attachPublicKey: Uint8Array.from(root.attachPublicKey),
    certificate: Uint8Array.from(root.certificate),
  };
}

class RuntimeIdentity implements IRuntimeIdentity {
  readonly #instance: IKeyPair;
  readonly #entropy: ILinkEntropy;
  #exchanged = false;
  #spawnerKey: Buffer | undefined;
  #trust: IRuntimeTrust | undefined;

  constructor(entropy: ILinkEntropy) {
    this.#entropy = entropy;
    const seed = entropy.seed();
    try {
      this.#instance = ed25519KeyPairFromSeed(seed);
    } finally {
      wipe(seed);
    }
    SECRETS.set(this, {
      instance: this.#instance,
      entropy,
      spawnerKey: () => this.#spawnerKey,
      trust: () => this.#trust,
    });
  }

  get instancePublicKey(): Uint8Array {
    return Uint8Array.from(this.#instance.publicKey);
  }

  get spawnerKeyHeld(): boolean {
    return this.#spawnerKey !== undefined;
  }

  get certified(): boolean {
    return this.#trust !== undefined;
  }

  answerSpawnerExchange(message: Uint8Array): Uint8Array {
    if (this.#exchanged) throw new LinkRefusedError('out-of-order');
    this.#exchanged = true;
    const { reply, spawnerKey } = answerSpawnerExchange(
      message,
      this.#instance.publicKey,
      this.#entropy,
    );
    this.#spawnerKey = spawnerKey;
    return reply;
  }

  installTrustRoot(root: ITrustRoot, binding: ILinkBinding): void {
    const checkedRoot = checkTrustRoot(root);
    const checkedBinding = checkLinkBinding(binding);
    if (this.#trust !== undefined) throw new LinkRefusedError('already-certified');
    if (this.#spawnerKey === undefined) throw new LinkRefusedError('spawner-unavailable');
    if (!certifies(checkedRoot, this.#instance.publicKey, checkedBinding)) {
      throw new LinkRefusedError('certificate-mismatch');
    }
    this.#trust = { root: checkedRoot, binding: checkedBinding };
    wipe(this.#spawnerKey);
    this.#spawnerKey = undefined;
  }
}

/** {@link createRuntimeIdentity} drawing from `entropy`; the package's own tests pass fixed values. */
export function createRuntimeIdentityWith(entropy: ILinkEntropy): IRuntimeIdentity {
  return new RuntimeIdentity(entropy);
}

/** A new runtime identity with a fresh instance key, uncertified and before its spawner exchange. */
export function createRuntimeIdentity(): IRuntimeIdentity {
  return createRuntimeIdentityWith(SYSTEM_LINK_ENTROPY);
}

/** Package-private: what the link responder needs of an identity this package made. */
export function runtimeIdentitySecrets(identity: IRuntimeIdentity): IRuntimeIdentitySecrets {
  const secrets = SECRETS.get(identity);
  if (secrets === undefined) {
    throw new KeyringError('invalid-argument', 'This is not a runtime identity this package made.');
  }
  return secrets;
}
