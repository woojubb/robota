/**
 * The spawner exchange: how a runtime and the process that started it come to share a key that no
 * other program holds.
 *
 * It runs once, over the socket pair the runtime inherited from its spawner and before the runtime
 * starts any child, so the two ends are known by construction. The spawner writes its X25519
 * ephemeral first; the runtime answers with its own ephemeral and its instance public key; each
 * side derives the spawner key from the shared secret, salted with a hash of all three public values
 * so the key is bound to this runtime's instance key. The spawner learns the instance key here, over
 * the one channel no other program reaches, and later certifies exactly that key.
 *
 * The spawner key has no lifetime of its own. The runtime forgets it when its trust root is
 * installed, and the spawner wipes it once it has certified the runtime, so it is never an owner
 * credential: it admits only the process that started this runtime, and only until certification.
 */
import { Buffer } from 'node:buffer';

import { isBytes, utf8, wipe } from './bytes.js';
import { KeyringError, LinkRefusedError } from './errors.js';
import type { IKeyPair } from './key-pairs.js';
import { KEY_BYTES } from './kdf.js';
import { SYSTEM_LINK_ENTROPY, type ILinkEntropy } from './link-entropy.js';
import { agree, ephemeralKeyPair, hashParts, hkdf } from './link-primitives.js';

/** Bound into the salt, so a key from this exchange is never one of any other derivation. */
export const SPAWNER_EXCHANGE_LABEL = 'robota/link/v1/spawner-exchange';
/** The HKDF `info` of the spawner key. */
export const SPAWNER_KEY_LABEL = 'robota/link/v1/spawner';
/** The spawner's message: its ephemeral public key. */
export const SPAWNER_EXCHANGE_MESSAGE_BYTES = KEY_BYTES;
/** The runtime's reply: its ephemeral public key, then its instance public key. */
export const SPAWNER_EXCHANGE_REPLY_BYTES = 2 * KEY_BYTES;

const SPAWNER_KEYS = new WeakMap<SpawnerKey, Buffer>();
/** Only this module holds it, so only a completed exchange can make a spawner key. */
const ISSUED = Symbol('spawner-key');

/**
 * The key a spawner shares with the runtime it started. Opaque: it offers only `wipe()`, and the link
 * initiator reads it through an accessor this package does not export. It has no expiry; it is
 * wiped by whoever holds it once it is no longer needed.
 */
export class SpawnerKey {
  constructor(issued: typeof ISSUED, bytes: Buffer) {
    if (issued !== ISSUED) {
      throw new KeyringError('invalid-argument', 'A spawner key comes only from an exchange.');
    }
    SPAWNER_KEYS.set(this, bytes);
  }

  get wiped(): boolean {
    return !SPAWNER_KEYS.has(this);
  }

  /** Zero-fills the key and forgets it. Idempotent. */
  wipe(): void {
    SPAWNER_KEYS.get(this)?.fill(0);
    SPAWNER_KEYS.delete(this);
  }
}

/** Package-private: the bytes of a spawner key, for the link initiator alone. */
export function spawnerKeyBytes(key: SpawnerKey): Buffer {
  const bytes = SPAWNER_KEYS.get(key);
  if (bytes === undefined) throw new KeyringError('keys-locked', 'The spawner key was wiped.');
  return bytes;
}

export interface ISpawnerExchangeResult {
  readonly spawnerKey: SpawnerKey;
  /** The runtime's instance public key, as it sent it over the inherited pair. */
  readonly instancePublicKey: Uint8Array;
}

/** The spawner's side of one exchange. */
export interface ISpawnerExchange {
  /** The first message to write to the runtime: the spawner's ephemeral public key. */
  readonly message: Uint8Array;
  /** Derives the spawner key from the runtime's reply. Once: the ephemeral is dropped by the first call. */
  complete(reply: Uint8Array): ISpawnerExchangeResult;
}

/** The spawner key both sides derive from the shared secret and the three public values. */
export function deriveSpawnerKey(
  sharedSecret: Uint8Array,
  spawnerEphemeral: Uint8Array,
  runtimeEphemeral: Uint8Array,
  instancePublicKey: Uint8Array,
): Buffer {
  const salt = hashParts([
    utf8(SPAWNER_EXCHANGE_LABEL),
    spawnerEphemeral,
    runtimeEphemeral,
    instancePublicKey,
  ]);
  return hkdf(sharedSecret, salt, SPAWNER_KEY_LABEL, KEY_BYTES);
}

/** {@link startSpawnerExchange} drawing from `entropy`; the package's own tests pass fixed values. */
export function startSpawnerExchangeWith(entropy: ILinkEntropy): ISpawnerExchange {
  let ephemeral: IKeyPair | undefined = ephemeralKeyPair(entropy);
  const message = Uint8Array.from(ephemeral.publicKey);
  return {
    message,
    complete(reply: Uint8Array): ISpawnerExchangeResult {
      const own = ephemeral;
      ephemeral = undefined;
      if (own === undefined) throw new LinkRefusedError('out-of-order');
      if (!isBytes(reply) || reply.length !== SPAWNER_EXCHANGE_REPLY_BYTES) {
        throw new LinkRefusedError('malformed');
      }
      const runtimeEphemeral = reply.subarray(0, KEY_BYTES);
      const instancePublicKey = Uint8Array.from(reply.subarray(KEY_BYTES));
      const shared = agree(own.privateKey, runtimeEphemeral);
      try {
        const key = deriveSpawnerKey(shared, own.publicKey, runtimeEphemeral, instancePublicKey);
        return { spawnerKey: new SpawnerKey(ISSUED, key), instancePublicKey };
      } finally {
        wipe(shared);
      }
    },
  };
}

/**
 * Starts the spawner's side of the exchange with a fresh ephemeral. Write `message` to the runtime
 * over the inherited pair, read its 64-byte reply, and `complete` it.
 */
export function startSpawnerExchange(): ISpawnerExchange {
  return startSpawnerExchangeWith(SYSTEM_LINK_ENTROPY);
}

/**
 * The runtime's side: its reply to the spawner's `message` and the spawner key, for its instance key.
 * The caller keeps the key; the ephemeral exists only inside this call.
 */
export function answerSpawnerExchange(
  message: Uint8Array,
  instancePublicKey: Uint8Array,
  entropy: ILinkEntropy,
): { readonly reply: Buffer; readonly spawnerKey: Buffer } {
  if (!isBytes(message) || message.length !== SPAWNER_EXCHANGE_MESSAGE_BYTES) {
    throw new LinkRefusedError('malformed');
  }
  const ephemeral = ephemeralKeyPair(entropy);
  const shared = agree(ephemeral.privateKey, message);
  try {
    return {
      reply: Buffer.concat([ephemeral.publicKey, instancePublicKey]),
      spawnerKey: deriveSpawnerKey(shared, message, ephemeral.publicKey, instancePublicKey),
    };
  } finally {
    wipe(shared);
  }
}
