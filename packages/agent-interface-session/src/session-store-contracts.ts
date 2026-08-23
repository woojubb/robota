/**
 * The persistence port for resumable interactive sessions, and the vocabulary its loads answer in.
 *
 * Split out of `session-contracts.ts` by TRANS-007: the port, its outcome union, its listing entry
 * and the decode-issue shape are one subject, and the file they were in is at its size ratchet.
 * It lives in this package rather than `agent-interface-transport` because ARCH-106 moved the
 * session contract family here; a store port is a session contract, and the owner map says so.
 */

import type { IInteractiveSessionRecord } from './session-contracts.js';

/**
 * One decode failure, located (TRANS-005).
 *
 * The TYPE lives here with the record it describes; the decoder that produces it is a mechanism and
 * lives with the runtime that owns persistence. `path` is the machine-readable half and is kept
 * separate from the human half on purpose: a caller that must CLASSIFY a failure cannot do it by
 * reading prose. The rendering is dotted for members and bracketed for indices —
 * `messages[2].timestamp` — and is empty at the root.
 */
export interface ISessionRecordDecodeIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * What a store concluded about one session id (TRANS-007).
 *
 * ## Why this is not `record | undefined`
 *
 * `undefined` was one value for four different situations — never saved, damaged, written by a build
 * this one cannot read, and the read itself failed — so every consumer had to guess, and they guessed
 * differently. The cost was not only an uninformative read: a consumer that loads a record to
 * preserve the fields it does not own, and then saves, treats "damaged" as "no prior record" and
 * OVERWRITES the damaged file with a fresh one. A type that makes the caller say which outcome it is
 * handling is what stops that, because the compiler asks the question the caller was not asking.
 *
 * `missing` is a member HERE and deliberately not a member of the decoder's outcome: absence is a
 * property of a store, not of a value — a file that is not there never reaches a decoder. This is
 * the store, so it composes its own `missing` with the decoder's three.
 */
export type TSessionLoadOutcome =
  | { readonly status: 'valid'; readonly record: IInteractiveSessionRecord }
  /** No record for this id. The only outcome from which a recovery path may run. */
  | { readonly status: 'missing' }
  /** Present and not a session record. Never silently replaced, never overwritten. */
  | { readonly status: 'corrupt'; readonly issues: readonly ISessionRecordDecodeIssue[] }
  /** Present and written by a build this one does not read. Carries the version it saw. */
  | { readonly status: 'unsupported'; readonly schemaVersion: number | undefined };

/**
 * One entry in a store listing, carrying WHY it cannot be read when it cannot.
 *
 * A store that distinguishes four outcomes on `load` and then hides two of them from the surface a
 * person browses has moved the defect rather than removed it: the difference a user experiences is
 * between "my session vanished" and "my session needs a different build".
 */
export interface ISessionListEntry {
  readonly id: string;
  readonly outcome: TSessionLoadOutcome;
}

/** Persistence port for resumable interactive sessions. */
export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord): void;
  load(id: string): TSessionLoadOutcome;
  list(): readonly ISessionListEntry[];
  delete(id: string): void;
}
