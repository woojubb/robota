/**
 * What the owner link asks of a runtime, and tells its clients, in domain terms.
 *
 * The owner vocabulary's wire shapes stop inside this package. A runtime answers an admitted link
 * through two ports: the desk, for custody (the trust root, the read grant, locking and the existing
 * control commands), and the session decisions, for the one owner decision that is not a session
 * protocol message (accepting a record not verified as the owner's). Both are given the link's
 * standing when the link is admitted, and decide what that standing may do: this package carries
 * requests, it does not grant them.
 */
import type { TOwnerSessionQuestion } from '@robota-sdk/agent-interface-session';
import type { IReadKeys, ITrustRoot } from '@robota-sdk/agent-keyring';

/** What a client may ask a runtime to lock for; idle and last-link-closed are the runtime's own. */
export type TRequestedLockReason = 'explicit' | 'screen-lock' | 'suspend' | 'fault';

/**
 * How a read grant went. `mismatch`: the keyring file's sealing public key is not the granted one;
 * the runtime seals to the granted key, and the owner is told to run `secure verify`.
 */
export type TGrantOutcome = 'verified' | 'mismatch';

/** What every linked client is told, once admitted and whenever it changes. */
export interface IRuntimeCustodyState {
  readonly unlocked: boolean;
  /** Whether owner links are possible: a spawner installed a trust root. */
  readonly certified: boolean;
}

/** One of the runtime's existing control commands, carried inside the link. */
export interface IOwnerControlRequest {
  readonly command: string;
  readonly fields: Readonly<Record<string, string>>;
}

export type TOwnerControlValue =
  | null
  | boolean
  | number
  | string
  | readonly TOwnerControlValue[]
  | { readonly [key: string]: TOwnerControlValue };

/** What a control command answered. */
export type TOwnerControlResult = { readonly [key: string]: TOwnerControlValue };

/** The runtime's custody answers for one admitted link. */
export interface IOwnerLinkDesk {
  /** The state the link announces as soon as it is admitted. */
  custody(): IRuntimeCustodyState;
  installTrustRoot(root: ITrustRoot): void | Promise<void>;
  /**
   * Installs the granted read keys. The desk owns them once this returns; when it refuses, by
   * throwing, the carrier locks them.
   */
  unlock(keys: IReadKeys): TGrantOutcome | Promise<TGrantOutcome>;
  lock(reason: TRequestedLockReason): void | Promise<void>;
  control(request: IOwnerControlRequest): TOwnerControlResult | Promise<TOwnerControlResult>;
  /** The link ended, for whatever reason. Called once. */
  closed(): void;
}

/** The runtime's session decisions for one admitted link. */
export interface IOwnerLinkSessions {
  question(sessionId: string): TOwnerSessionQuestion | Promise<TOwnerSessionQuestion>;
  cancelQuestion(): void | Promise<void>;
  openAccepted(bindingId: string, sessionId: string, acceptedDigest: string, questionId: string): void | Promise<void>;
}

/** Where the session protocol of an admitted link goes: one serialized client message at a time. */
export interface ILinkSessionSink {
  receive(data: string): void;
}

const REFUSAL_CODE = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_REFUSAL_MESSAGE_LENGTH = 1024;

/**
 * A request the runtime refused, by decision: a desk throws it with a fixed code and fixed text, and
 * the client rejects with it. Any other failure reaches the client as `failed`, never with its text.
 */
export class OwnerRequestRefusedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    if (
      !REFUSAL_CODE.test(code) ||
      message.length === 0 ||
      message.length > MAX_REFUSAL_MESSAGE_LENGTH
    ) {
      throw new RangeError('A refusal has a lower-case code and a message of 1-1024 characters.');
    }
    super(message);
    this.name = 'OwnerRequestRefusedError';
    this.code = code;
  }
}

/** The link closed, or never opened: the other end does not say why. */
export class OwnerLinkClosedError extends Error {
  constructor() {
    super('The owner link closed.');
    this.name = 'OwnerLinkClosedError';
  }
}
