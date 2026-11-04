/**
 * Frame protection once a link is established.
 *
 * Every frame after the handshake is AES-256-GCM under the key of its direction, with a 96-bit
 * big-endian counter as the nonce and the direction and frame kind as the AAD. The counter is never
 * sent: each end expects the next one, so a replayed, reordered, dropped or misdirected frame fails
 * authentication like a tampered one, and the first frame that fails closes the link. A relay
 * between the two ends can only carry or drop frames.
 *
 * There are three kinds. `session` and `owner` frames carry bytes the carrier decodes. A `grant`
 * frame carries the owner's read keys and never passes through JSON: it is sealed from and opened
 * into key objects and byte buffers this module zero-fills. A grant travels only on an owner link,
 * from the handover that opened it, because whoever can send one decides which key the runtime
 * seals to.
 */
import { Buffer } from 'node:buffer';

import { gcmDecrypt, gcmEncrypt, GCM_IV_BYTES, GCM_TAG_BYTES } from './aead.js';
import { isBytes, wipe } from './bytes.js';
import { KeyringError, LinkRefusedError } from './errors.js';
import { x25519KeyPairFromSeed } from './key-pairs.js';
import { KEY_BYTES } from './kdf.js';
import { ownerHandoverSecrets, type IOwnerHandover } from './owner-handover.js';
import { createReadKeys, type IReadKeys } from './read-keys.js';
import type { ILinkBinding } from './runtime-certificate.js';

/** How the initiator was admitted, which is the standing its link has. */
export type TLinkMode = 'spawner' | 'owner';
export type TLinkFrameKind = 'session' | 'owner' | 'grant';
/** The kinds a caller seals and opens as bytes; a grant has its own two operations. */
export type TLinkDataFrameKind = Exclude<TLinkFrameKind, 'grant'>;

const KIND_BYTES: Readonly<Record<TLinkFrameKind, number>> = { session: 1, owner: 2, grant: 3 };
const KINDS_BY_BYTE: ReadonlyMap<number, TLinkFrameKind> = new Map(
  Object.entries(KIND_BYTES).map(([kind, byte]) => [byte, kind as TLinkFrameKind]),
);
/** The direction byte of the AAD names the sending end. */
const DIRECTION_BYTES = { initiator: 1, responder: 2 } as const;
type TLinkRole = keyof typeof DIRECTION_BYTES;

/** The kind byte and the GCM tag around every frame's ciphertext. */
export const LINK_FRAME_OVERHEAD_BYTES = 1 + GCM_TAG_BYTES;
/** The most one frame carries; a carrier bounds its frames below this. */
export const LINK_FRAME_MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const GRANT_VERSION = 1;
/** version | sealing key seed | authorship key */
const GRANT_PLAINTEXT_BYTES = 1 + KEY_BYTES + KEY_BYTES;
/** A sealed read grant is always exactly this long. */
export const LINK_GRANT_FRAME_BYTES = GRANT_PLAINTEXT_BYTES + LINK_FRAME_OVERHEAD_BYTES;

export interface ILinkFrameKeys {
  readonly initiatorToResponder: Buffer;
  readonly responderToInitiator: Buffer;
}

/** The kind a frame says it is. Unauthenticated until it opens, which checks the kind too. */
export function linkFrameKind(frame: Uint8Array): TLinkFrameKind {
  const kind =
    isBytes(frame) && frame.length >= LINK_FRAME_OVERHEAD_BYTES
      ? KINDS_BY_BYTE.get(frame[0]!)
      : undefined;
  if (kind === undefined) throw new LinkRefusedError('malformed');
  return kind;
}

function nonceFor(counter: number): Buffer {
  const nonce = Buffer.alloc(GCM_IV_BYTES);
  nonce.writeBigUInt64BE(BigInt(counter), GCM_IV_BYTES - 8);
  return nonce;
}

/** One end of an established link. */
export interface IEstablishedLink {
  readonly standing: TLinkMode;
  /** The runtime start the link is bound to: authenticated by the handshake on both ends. */
  readonly binding: ILinkBinding;
  /** The runtime's instance key: checked by the initiator, its own at the responder. */
  readonly instancePublicKey: Uint8Array;
  readonly closed: boolean;
  seal(kind: TLinkDataFrameKind, plaintext: Uint8Array): Uint8Array;
  /** The next frame from the other end; throws, and closes the link, unless it is exactly that. */
  open(frame: Uint8Array): { readonly kind: TLinkDataFrameKind; readonly plaintext: Buffer };
  /** Zero-fills both frame keys. Idempotent. */
  close(): void;
}

export interface IInitiatorLink extends IEstablishedLink {
  /**
   * The owner's read keys (the sealing key and the authorship key, never the master key or the
   * attach key) as one grant frame. Only on an owner link, and only from the handover that opened it.
   */
  sealReadGrant(handover: IOwnerHandover): Uint8Array;
}

export interface IResponderLink extends IEstablishedLink {
  /** The read keys a grant frame carries. Only on an owner-standing link; anything else closes it. */
  openReadGrant(frame: Uint8Array): IReadKeys;
}

abstract class LinkEnd implements IEstablishedLink {
  readonly standing: TLinkMode;
  readonly binding: ILinkBinding;
  readonly #role: TLinkRole;
  readonly #instancePublicKey: Uint8Array;
  #sendKey: Buffer | undefined;
  #receiveKey: Buffer | undefined;
  #sent = 0;
  #received = 0;

  constructor(
    role: TLinkRole,
    standing: TLinkMode,
    binding: ILinkBinding,
    instancePublicKey: Uint8Array,
    keys: ILinkFrameKeys,
  ) {
    this.#role = role;
    this.standing = standing;
    this.binding = Object.freeze({ runtimeId: binding.runtimeId, generation: binding.generation });
    this.#instancePublicKey = Uint8Array.from(instancePublicKey);
    this.#sendKey = role === 'initiator' ? keys.initiatorToResponder : keys.responderToInitiator;
    this.#receiveKey = role === 'initiator' ? keys.responderToInitiator : keys.initiatorToResponder;
  }

  get instancePublicKey(): Uint8Array {
    return Uint8Array.from(this.#instancePublicKey);
  }

  get closed(): boolean {
    return this.#sendKey === undefined;
  }

  seal(kind: TLinkDataFrameKind, plaintext: Uint8Array): Uint8Array {
    if (kind !== 'session' && kind !== 'owner') {
      throw new KeyringError('invalid-argument', 'A frame is a session or an owner frame.');
    }
    return this.sealKind(kind, plaintext);
  }

  open(frame: Uint8Array): { readonly kind: TLinkDataFrameKind; readonly plaintext: Buffer } {
    const kind = this.kindOf(frame);
    if (kind === 'grant') {
      this.close();
      throw new KeyringError('invalid-argument', 'A read grant opens only as a grant.');
    }
    return { kind, plaintext: this.openKind(frame, kind) };
  }

  close(): void {
    wipe(this.#sendKey, this.#receiveKey);
    this.#sendKey = undefined;
    this.#receiveKey = undefined;
  }

  protected sealKind(kind: TLinkFrameKind, plaintext: Uint8Array): Uint8Array {
    if (!isBytes(plaintext) || plaintext.length > LINK_FRAME_MAX_PLAINTEXT_BYTES) {
      throw new KeyringError(
        'invalid-argument',
        `A frame carries 0-${LINK_FRAME_MAX_PLAINTEXT_BYTES} bytes.`,
      );
    }
    const key = this.#requireOpen(this.#sendKey);
    if (!Number.isSafeInteger(this.#sent + 1)) {
      this.close();
      throw new KeyringError('link-closed', 'The link has sent all the frames it can.');
    }
    const aad = Buffer.from([DIRECTION_BYTES[this.#role], KIND_BYTES[kind]]);
    const sealed = gcmEncrypt(key, nonceFor(this.#sent), plaintext, aad);
    this.#sent += 1;
    return Buffer.concat([Buffer.from([KIND_BYTES[kind]]), sealed]);
  }

  /** The frame's kind; a frame that is not one closes the link. */
  protected kindOf(frame: Uint8Array): TLinkFrameKind {
    this.#requireOpen(this.#receiveKey);
    try {
      return linkFrameKind(frame);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** The next frame's plaintext, which the caller owns; any failure closes the link. */
  protected openKind(frame: Uint8Array, kind: TLinkFrameKind): Buffer {
    const key = this.#requireOpen(this.#receiveKey);
    const peer: TLinkRole = this.#role === 'initiator' ? 'responder' : 'initiator';
    const aad = Buffer.from([DIRECTION_BYTES[peer], KIND_BYTES[kind]]);
    let plaintext: Buffer;
    try {
      plaintext = gcmDecrypt(key, nonceFor(this.#received), frame.subarray(1), aad);
    } catch (error) {
      this.close();
      throw error;
    }
    this.#received += 1;
    return plaintext;
  }

  #requireOpen(key: Buffer | undefined): Buffer {
    if (key === undefined) throw new KeyringError('link-closed', 'The link is closed.');
    return key;
  }
}

export class InitiatorLink extends LinkEnd implements IInitiatorLink {
  readonly #handover: IOwnerHandover | undefined;

  constructor(
    standing: TLinkMode,
    binding: ILinkBinding,
    instancePublicKey: Uint8Array,
    keys: ILinkFrameKeys,
    handover: IOwnerHandover | undefined,
  ) {
    super('initiator', standing, binding, instancePublicKey, keys);
    this.#handover = handover;
  }

  sealReadGrant(handover: IOwnerHandover): Uint8Array {
    if (this.standing !== 'owner' || handover !== this.#handover) {
      throw new KeyringError(
        'invalid-argument',
        'A read grant goes only over an owner link, from the handover that opened it.',
      );
    }
    const { sealingSeed, authorship } = ownerHandoverSecrets(handover);
    const plaintext = Buffer.alloc(GRANT_PLAINTEXT_BYTES);
    try {
      plaintext[0] = GRANT_VERSION;
      sealingSeed.copy(plaintext, 1);
      authorship.copy(plaintext, 1 + KEY_BYTES);
      return this.sealKind('grant', plaintext);
    } finally {
      wipe(plaintext);
    }
  }
}

export class ResponderLink extends LinkEnd implements IResponderLink {
  constructor(
    standing: TLinkMode,
    binding: ILinkBinding,
    instancePublicKey: Uint8Array,
    keys: ILinkFrameKeys,
  ) {
    super('responder', standing, binding, instancePublicKey, keys);
  }

  openReadGrant(frame: Uint8Array): IReadKeys {
    if (this.standing !== 'owner') {
      this.close();
      throw new KeyringError('invalid-argument', 'A read grant is accepted only on an owner link.');
    }
    if (this.kindOf(frame) !== 'grant') {
      this.close();
      throw new KeyringError('invalid-argument', 'Only a read grant opens as a grant.');
    }
    const plaintext = this.openKind(frame, 'grant');
    try {
      if (plaintext.length !== GRANT_PLAINTEXT_BYTES || plaintext[0] !== GRANT_VERSION) {
        this.close();
        throw new LinkRefusedError('malformed');
      }
      const sealing = x25519KeyPairFromSeed(plaintext.subarray(1, 1 + KEY_BYTES));
      return createReadKeys(sealing, Buffer.from(plaintext.subarray(1 + KEY_BYTES)));
    } finally {
      wipe(plaintext);
    }
  }
}
