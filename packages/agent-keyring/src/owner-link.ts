/**
 * The owner link handshake: how a client and a served runtime decide that each is who it must be,
 * before anything that depends on a secret crosses between them.
 *
 *   I → R  Hello      v=1 | mode | e_i | n_i
 *   R → I  Challenge  e_r | n_r | inst | runtime id | generation | cert? | auth_r
 *   I → R  Proof      auth_i
 *
 *   th = SHA-256 of the length-prefixed label, mode, e_i, n_i, e_r, n_r, inst, runtime id,
 *        generation and certificate (empty in spawner mode)
 *   spawner: auth_r = HMAC(K_s, "r" | th) | Sig_inst("r" | th);  auth_i = HMAC(K_s, "i" | th)
 *   owner:   auth_r = Sig_inst("r" | th), with the certificate;   auth_i = Sig_attach("i" | th)
 *   frame keys = HKDF(X25519(e_i, e_r), salt = th, "robota/link/v1/frames"), one per direction
 *
 * The runtime answers first, and the initiator checks the whole answer before it produces its
 * proof. A spawner checks that the instance key is the one its exchange carried, then both halves of
 * `auth_r`: only the child it started holds the spawner key and that instance key. An owner checks
 * the certificate under the attach key it derived itself, for exactly the instance and binding the
 * answer names, then the instance signature. So a program on a taken-over socket, a runtime nobody
 * certified and a runtime another keyring certified are all refused having received only a hello,
 * which is fresh randomness. The mode, the binding and both ephemerals are in `th`, so no answer can
 * be moved to another mode, another link or another runtime start.
 *
 * Every refusal is a `LinkRefusedError` naming the failed check for the caller's logs; the carrier
 * closes the stream and tells the other end nothing.
 */
import { Buffer } from 'node:buffer';

import { concatLengthPrefixed, isBytes, utf8, wipe } from './bytes.js';
import { KeyringError, LinkRefusedError } from './errors.js';
import type { IKeyPair } from './key-pairs.js';
import { KEY_BYTES } from './kdf.js';
import { SYSTEM_LINK_ENTROPY, LINK_NONCE_BYTES, type ILinkEntropy } from './link-entropy.js';
import {
  InitiatorLink,
  ResponderLink,
  type IInitiatorLink,
  type ILinkFrameKeys,
  type IResponderLink,
  type TLinkMode,
} from './link-frames.js';
import { agree, ephemeralKeyPair, hashParts, hkdf, hmac, sameBytes } from './link-primitives.js';
import { ownerHandoverSecrets, type IOwnerHandover } from './owner-handover.js';
import {
  certifies,
  checkLinkBinding,
  decodeBindingPart,
  MAX_BINDING_PART_LENGTH,
  requireInstanceKey,
  type ILinkBinding,
} from './runtime-certificate.js';
import { runtimeIdentitySecrets, type IRuntimeIdentity } from './runtime-identity.js';
import { SIGNATURE_BYTES, signEd25519, verifyEd25519 } from './signatures.js';
import { spawnerKeyBytes, type SpawnerKey } from './spawner-exchange.js';

export const LINK_PROTOCOL_VERSION = 1;
export const LINK_HANDSHAKE_LABEL = 'robota/link/v1/handshake';
export const LINK_FRAME_KEYS_LABEL = 'robota/link/v1/frames';

const MODE_BYTES: Readonly<Record<TLinkMode, number>> = { spawner: 1, owner: 2 };
const HMAC_BYTES = 32;
const CERTIFICATE_BYTES: Readonly<Record<TLinkMode, number>> = {
  spawner: 0,
  owner: SIGNATURE_BYTES,
};
const RUNTIME_PROOF_BYTES: Readonly<Record<TLinkMode, number>> = {
  spawner: HMAC_BYTES + SIGNATURE_BYTES,
  owner: SIGNATURE_BYTES,
};
const PROOF_BYTES: Readonly<Record<TLinkMode, number>> = {
  spawner: HMAC_BYTES,
  owner: SIGNATURE_BYTES,
};
const LENGTH_PREFIX_BYTES = 2;
const RESPONDER_TAG = utf8('r');
const INITIATOR_TAG = utf8('i');

/** version | mode | e_i | n_i */
export const LINK_HELLO_BYTES = 2 + KEY_BYTES + LINK_NONCE_BYTES;
/** The longest challenge either mode can send. */
export const LINK_CHALLENGE_MAX_BYTES =
  KEY_BYTES +
  LINK_NONCE_BYTES +
  KEY_BYTES +
  3 * LENGTH_PREFIX_BYTES +
  2 * MAX_BINDING_PART_LENGTH +
  Math.max(...Object.values(CERTIFICATE_BYTES)) +
  Math.max(...Object.values(RUNTIME_PROOF_BYTES));
/** The longest proof either mode can send. */
export const LINK_PROOF_MAX_BYTES = Math.max(...Object.values(PROOF_BYTES));

/** How the initiator proves itself: the spawner by its spawner key, the owner by its handover. */
export type TLinkInitiatorAuth =
  | {
      readonly mode: 'spawner';
      readonly spawnerKey: SpawnerKey;
      /** The instance key the spawner exchange carried. */
      readonly instancePublicKey: Uint8Array;
    }
  | { readonly mode: 'owner'; readonly handover: IOwnerHandover };

/** Everything the transcript hash covers. */
export interface ILinkTranscript {
  readonly mode: TLinkMode;
  readonly initiatorEphemeral: Uint8Array;
  readonly initiatorNonce: Uint8Array;
  readonly responderEphemeral: Uint8Array;
  readonly responderNonce: Uint8Array;
  readonly instancePublicKey: Uint8Array;
  readonly binding: ILinkBinding;
  /** Empty in spawner mode. */
  readonly certificate: Uint8Array;
}

export function transcriptHash(transcript: ILinkTranscript): Buffer {
  return hashParts([
    utf8(LINK_HANDSHAKE_LABEL),
    Buffer.from([MODE_BYTES[transcript.mode]]),
    transcript.initiatorEphemeral,
    transcript.initiatorNonce,
    transcript.responderEphemeral,
    transcript.responderNonce,
    transcript.instancePublicKey,
    utf8(transcript.binding.runtimeId),
    utf8(transcript.binding.generation),
    transcript.certificate,
  ]);
}

/** One key per direction from the handshake's shared secret, salted with the transcript hash. */
export function deriveFrameKeys(sharedSecret: Uint8Array, th: Uint8Array): ILinkFrameKeys {
  const keys = hkdf(sharedSecret, th, LINK_FRAME_KEYS_LABEL, 2 * KEY_BYTES);
  try {
    return {
      initiatorToResponder: Buffer.from(keys.subarray(0, KEY_BYTES)),
      responderToInitiator: Buffer.from(keys.subarray(KEY_BYTES)),
    };
  } finally {
    wipe(keys);
  }
}

function frameKeysFor(
  ephemeral: IKeyPair,
  peerEphemeral: Uint8Array,
  th: Uint8Array,
): ILinkFrameKeys {
  const shared = agree(ephemeral.privateKey, peerEphemeral);
  try {
    return deriveFrameKeys(shared, th);
  } finally {
    wipe(shared);
  }
}

interface IChallenge {
  readonly responderEphemeral: Uint8Array;
  readonly responderNonce: Uint8Array;
  readonly instancePublicKey: Uint8Array;
  readonly binding: ILinkBinding;
  readonly certificate: Uint8Array;
  readonly runtimeProof: Uint8Array;
}

function encodeChallenge(challenge: IChallenge): Buffer {
  return Buffer.concat([
    challenge.responderEphemeral,
    challenge.responderNonce,
    challenge.instancePublicKey,
    concatLengthPrefixed([
      utf8(challenge.binding.runtimeId),
      utf8(challenge.binding.generation),
      challenge.certificate,
    ]),
    challenge.runtimeProof,
  ]);
}

/** The challenge `bytes` encodes for an initiator in `mode`, or `malformed`: every length is exact. */
function decodeChallenge(bytes: unknown, mode: TLinkMode): IChallenge {
  if (!isBytes(bytes) || bytes.length > LINK_CHALLENGE_MAX_BYTES)
    throw new LinkRefusedError('malformed');
  let offset = 0;
  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length) throw new LinkRefusedError('malformed');
    const part = Uint8Array.from(bytes.subarray(offset, offset + length));
    offset += length;
    return part;
  };
  const takePrefixed = (): Uint8Array => {
    const prefix = take(LENGTH_PREFIX_BYTES);
    return take((prefix[0]! << 8) | prefix[1]!);
  };
  const responderEphemeral = take(KEY_BYTES);
  const responderNonce = take(LINK_NONCE_BYTES);
  const instancePublicKey = take(KEY_BYTES);
  const runtimeId = decodeBindingPart(takePrefixed());
  const generation = decodeBindingPart(takePrefixed());
  const certificate = takePrefixed();
  const runtimeProof = take(bytes.length - offset);
  if (
    runtimeId === undefined ||
    generation === undefined ||
    certificate.length !== CERTIFICATE_BYTES[mode] ||
    runtimeProof.length !== RUNTIME_PROOF_BYTES[mode]
  ) {
    throw new LinkRefusedError('malformed');
  }
  return {
    responderEphemeral,
    responderNonce,
    instancePublicKey,
    binding: { runtimeId, generation },
    certificate,
    runtimeProof,
  };
}

function decodeHello(bytes: unknown): {
  readonly mode: TLinkMode;
  readonly ephemeral: Uint8Array;
  readonly nonce: Uint8Array;
} {
  if (!isBytes(bytes) || bytes.length !== LINK_HELLO_BYTES || bytes[0] !== LINK_PROTOCOL_VERSION) {
    throw new LinkRefusedError('malformed');
  }
  const mode =
    bytes[1] === MODE_BYTES.spawner
      ? 'spawner'
      : bytes[1] === MODE_BYTES.owner
        ? 'owner'
        : undefined;
  if (mode === undefined) throw new LinkRefusedError('malformed');
  return {
    mode,
    ephemeral: Uint8Array.from(bytes.subarray(2, 2 + KEY_BYTES)),
    nonce: Uint8Array.from(bytes.subarray(2 + KEY_BYTES)),
  };
}

/** The client side of one handshake. */
export interface ILinkInitiator {
  readonly mode: TLinkMode;
  /** The first message: the version, the mode, a fresh ephemeral and a fresh nonce. Once. */
  hello(): Uint8Array;
  /**
   * Checks the runtime's challenge and, only if every check passed, returns the proof to send and
   * the established link. Throws `LinkRefusedError` otherwise. Once, whatever the outcome.
   */
  answer(challenge: Uint8Array): { readonly proof: Uint8Array; readonly link: IInitiatorLink };
}

type TInitiatorState =
  | { readonly step: 'new' }
  | {
      readonly step: 'waiting';
      readonly ephemeral: IKeyPair;
      readonly nonce: Uint8Array;
    }
  | { readonly step: 'spent' };

class LinkInitiator implements ILinkInitiator {
  readonly mode: TLinkMode;
  readonly #auth: TLinkInitiatorAuth;
  readonly #entropy: ILinkEntropy;
  readonly #expectedInstance: Uint8Array | undefined;
  #state: TInitiatorState = { step: 'new' };

  constructor(auth: TLinkInitiatorAuth, entropy: ILinkEntropy) {
    if (auth?.mode === 'spawner') {
      spawnerKeyBytes(auth.spawnerKey);
      this.#expectedInstance = Uint8Array.from(requireInstanceKey(auth.instancePublicKey));
    } else if (auth?.mode === 'owner') {
      ownerHandoverSecrets(auth.handover);
    } else {
      throw new KeyringError('invalid-argument', 'A link initiator is a spawner or an owner.');
    }
    this.mode = auth.mode;
    this.#auth = auth;
    this.#entropy = entropy;
  }

  hello(): Uint8Array {
    if (this.#state.step !== 'new') throw new LinkRefusedError('out-of-order');
    const ephemeral = ephemeralKeyPair(this.#entropy);
    const nonce = this.#entropy.nonce();
    this.#state = { step: 'waiting', ephemeral, nonce };
    return Buffer.concat([
      Buffer.from([LINK_PROTOCOL_VERSION, MODE_BYTES[this.mode]]),
      ephemeral.publicKey,
      nonce,
    ]);
  }

  answer(challenge: Uint8Array): { readonly proof: Uint8Array; readonly link: IInitiatorLink } {
    const state = this.#state;
    if (state.step !== 'waiting') throw new LinkRefusedError('out-of-order');
    this.#state = { step: 'spent' };
    const answer = decodeChallenge(challenge, this.mode);
    if (
      this.#auth.mode === 'spawner' &&
      !sameBytes(answer.instancePublicKey, this.#expectedInstance!)
    ) {
      throw new LinkRefusedError('instance-mismatch');
    }
    if (this.#auth.mode === 'owner') {
      const { attach } = ownerHandoverSecrets(this.#auth.handover);
      const root = { attachPublicKey: attach.publicKey, certificate: answer.certificate };
      if (!certifies(root, answer.instancePublicKey, answer.binding)) {
        throw new LinkRefusedError('certificate-mismatch');
      }
    }
    const th = transcriptHash({
      mode: this.mode,
      initiatorEphemeral: state.ephemeral.publicKey,
      initiatorNonce: state.nonce,
      responderEphemeral: answer.responderEphemeral,
      responderNonce: answer.responderNonce,
      instancePublicKey: answer.instancePublicKey,
      binding: answer.binding,
      certificate: answer.certificate,
    });
    const signed = Buffer.concat([RESPONDER_TAG, th]);
    if (this.#auth.mode === 'spawner') {
      const spawnerKey = spawnerKeyBytes(this.#auth.spawnerKey);
      const macMatches = sameBytes(
        hmac(spawnerKey, RESPONDER_TAG, th),
        answer.runtimeProof.subarray(0, HMAC_BYTES),
      );
      const signatureMatches = verifyEd25519(
        answer.instancePublicKey,
        signed,
        answer.runtimeProof.subarray(HMAC_BYTES),
      );
      if (!macMatches || !signatureMatches) throw new LinkRefusedError('bad-runtime-proof');
    } else if (!verifyEd25519(answer.instancePublicKey, signed, answer.runtimeProof)) {
      throw new LinkRefusedError('bad-runtime-proof');
    }
    // Every check passed: from here on the initiator may produce what depends on its secret.
    const keys = frameKeysFor(state.ephemeral, answer.responderEphemeral, th);
    const proof =
      this.#auth.mode === 'spawner'
        ? hmac(spawnerKeyBytes(this.#auth.spawnerKey), INITIATOR_TAG, th)
        : signEd25519(
            ownerHandoverSecrets(this.#auth.handover).attach.privateKey,
            Buffer.concat([INITIATOR_TAG, th]),
          );
    const handover = this.#auth.mode === 'owner' ? this.#auth.handover : undefined;
    return {
      proof,
      link: new InitiatorLink(this.mode, answer.binding, answer.instancePublicKey, keys, handover),
    };
  }
}

/** {@link createLinkInitiator} drawing from `entropy`; the package's own tests pass fixed values. */
export function createLinkInitiatorWith(
  auth: TLinkInitiatorAuth,
  entropy: ILinkEntropy,
): ILinkInitiator {
  return new LinkInitiator(auth, entropy);
}

/**
 * The client side of a handshake. A wiped spawner key or a disposed handover is refused here, before
 * any message exists.
 */
export function createLinkInitiator(auth: TLinkInitiatorAuth): ILinkInitiator {
  return createLinkInitiatorWith(auth, SYSTEM_LINK_ENTROPY);
}

/** The runtime side of one handshake. */
export interface ILinkResponder {
  /**
   * Answers a hello, or throws `LinkRefusedError`: a malformed hello, spawner mode without the
   * spawner key, or owner mode without a trust root for this binding. Once.
   */
  challenge(hello: Uint8Array): Uint8Array;
  /** Checks the proof; the established link and the standing it earned. Once. */
  accept(proof: Uint8Array): { readonly standing: TLinkMode; readonly link: IResponderLink };
}

interface IPendingResponse {
  readonly mode: TLinkMode;
  readonly th: Buffer;
  readonly keys: ILinkFrameKeys;
  /** Spawner mode: the proof only a spawner-key holder can make. */
  readonly expectedProof?: Buffer;
  /** Owner mode: the attach key the proof must verify under. */
  readonly attachPublicKey?: Uint8Array;
}

class LinkResponder implements ILinkResponder {
  readonly #identity: IRuntimeIdentity;
  readonly #binding: ILinkBinding;
  #step: 'new' | 'waiting' | 'spent' = 'new';
  #pending: IPendingResponse | undefined;

  constructor(identity: IRuntimeIdentity, binding: ILinkBinding) {
    runtimeIdentitySecrets(identity);
    this.#identity = identity;
    this.#binding = checkLinkBinding(binding);
  }

  challenge(hello: Uint8Array): Uint8Array {
    if (this.#step !== 'new') throw new LinkRefusedError('out-of-order');
    this.#step = 'spent';
    const { mode, ephemeral: initiatorEphemeral, nonce: initiatorNonce } = decodeHello(hello);
    const secrets = runtimeIdentitySecrets(this.#identity);
    const spawnerKey = secrets.spawnerKey();
    const trust = secrets.trust();
    if (mode === 'spawner' && spawnerKey === undefined) {
      throw new LinkRefusedError('spawner-unavailable');
    }
    if (
      mode === 'owner' &&
      (trust === undefined ||
        trust.binding.runtimeId !== this.#binding.runtimeId ||
        trust.binding.generation !== this.#binding.generation)
    ) {
      throw new LinkRefusedError('not-certified');
    }
    const ephemeral = ephemeralKeyPair(secrets.entropy);
    const responderNonce = secrets.entropy.nonce();
    const certificate = mode === 'owner' ? trust!.root.certificate : new Uint8Array(0);
    const th = transcriptHash({
      mode,
      initiatorEphemeral,
      initiatorNonce,
      responderEphemeral: ephemeral.publicKey,
      responderNonce,
      instancePublicKey: secrets.instance.publicKey,
      binding: this.#binding,
      certificate,
    });
    const keys = frameKeysFor(ephemeral, initiatorEphemeral, th);
    const signature = signEd25519(secrets.instance.privateKey, Buffer.concat([RESPONDER_TAG, th]));
    const runtimeProof =
      mode === 'spawner'
        ? Buffer.concat([hmac(spawnerKey!, RESPONDER_TAG, th), signature])
        : signature;
    this.#pending = {
      mode,
      th,
      keys,
      ...(mode === 'spawner'
        ? { expectedProof: hmac(spawnerKey!, INITIATOR_TAG, th) }
        : { attachPublicKey: Uint8Array.from(trust!.root.attachPublicKey) }),
    };
    this.#step = 'waiting';
    return encodeChallenge({
      responderEphemeral: ephemeral.publicKey,
      responderNonce,
      instancePublicKey: secrets.instance.publicKey,
      binding: this.#binding,
      certificate,
      runtimeProof,
    });
  }

  accept(proof: Uint8Array): { readonly standing: TLinkMode; readonly link: IResponderLink } {
    const pending = this.#pending;
    if (this.#step !== 'waiting' || pending === undefined)
      throw new LinkRefusedError('out-of-order');
    this.#pending = undefined;
    this.#step = 'spent';
    try {
      if (!isBytes(proof) || proof.length !== PROOF_BYTES[pending.mode]) {
        throw new LinkRefusedError('malformed');
      }
      if (pending.mode === 'spawner') {
        // The spawner key may have been forgotten since the challenge: certification ends spawner standing.
        if (runtimeIdentitySecrets(this.#identity).spawnerKey() === undefined) {
          throw new LinkRefusedError('spawner-unavailable');
        }
        if (!sameBytes(pending.expectedProof!, proof)) throw new LinkRefusedError('bad-proof');
      } else if (
        !verifyEd25519(pending.attachPublicKey!, Buffer.concat([INITIATOR_TAG, pending.th]), proof)
      ) {
        throw new LinkRefusedError('bad-proof');
      }
    } catch (error) {
      wipe(
        pending.keys.initiatorToResponder,
        pending.keys.responderToInitiator,
        pending.expectedProof,
      );
      throw error;
    }
    wipe(pending.expectedProof);
    const instancePublicKey = runtimeIdentitySecrets(this.#identity).instance.publicKey;
    return {
      standing: pending.mode,
      link: new ResponderLink(pending.mode, this.#binding, instancePublicKey, pending.keys),
    };
  }
}

/**
 * The runtime side of a handshake, for `identity` at the runtime start `binding` names. Which
 * standing may then do what is the runtime custody's decision, not this module's.
 */
export function createLinkResponder(
  identity: IRuntimeIdentity,
  binding: ILinkBinding,
): ILinkResponder {
  return new LinkResponder(identity, binding);
}
