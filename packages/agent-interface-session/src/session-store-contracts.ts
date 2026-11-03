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
 *
 * `locked` is a fifth answer for the same reason: a sealed record is present and intact, and this
 * process simply holds no key that opens it right now. It is not `missing` (a recovery path would
 * then run over a session that is still there) and not `corrupt` (nothing is wrong with it, and a
 * later unlock reads it) — so it is its own member, and a caller that writes must treat it like
 * `corrupt`: there IS a record and writing over it destroys the only copy. The one exception is a
 * session this very store wrote, or loaded to hold, which `loadHeld` hands back.
 */
export type TSessionLoadOutcome =
  | { readonly status: 'valid'; readonly record: IInteractiveSessionRecord }
  /** No record for this id. The only outcome from which a recovery path may run. */
  | { readonly status: 'missing' }
  /**
   * Present and not a session record. Never silently replaced, never overwritten.
   *
   * `cwd` is a best-effort read of the raw bytes, present when they still carry a plain `cwd`
   * string despite failing full decode — so a caller that only needs to know which workspace this
   * record belongs to is not forced to treat every corrupt record as workspace-unknown.
   */
  | {
      readonly status: 'corrupt';
      readonly issues: readonly ISessionRecordDecodeIssue[];
      readonly cwd?: string;
    }
  /**
   * Present and written by a build this one does not read. Carries the version it saw, and `cwd`
   * when the raw bytes still carry a plain `cwd` string despite the version mismatch — this is the
   * shape a pre-envelope legacy record takes. A file sealed in a framing version this build does not
   * open is this too, with no version and no `cwd`, since nothing inside it can be read.
   */
  | {
      readonly status: 'unsupported';
      readonly schemaVersion: number | undefined;
      readonly cwd?: string;
    }
  /**
   * Present, sealed, and unreadable to this process right now. Carries nothing read from inside it,
   * only why: absent `reason`, the keys that open it are locked and an unlock would read it.
   */
  | { readonly status: 'locked'; readonly reason?: TSessionLockedReason };

/**
 * Why a `locked` record cannot be read here, beyond locked keys. `no-keys`: this store was given no
 * keys at all, so no unlock in this process opens it (it was sealed elsewhere, or by a build or a
 * setting this process does not have). `changed`: this store holds the session, but the file is no
 * longer the bytes it wrote or read, so what it holds is not what is there.
 */
export type TSessionLockedReason = 'no-keys' | 'changed';

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

/** How a load is meant, which decides what a store that seals keeps from it. */
export interface ISessionLoadOptions {
  /**
   * The caller is resuming or updating this session and will save it. A store that seals remembers
   * a sealed record it opens for such a load, so the process can go on saving the session after the
   * keys lock. A probe — a report, a "does it exist" check, an attach — leaves it unset, and nothing
   * it read is remembered.
   */
  readonly hold?: boolean;
}

/** How a save is meant, which decides what a store that seals keeps from it. */
export interface ISessionSaveOptions {
  /**
   * The record is written to be handed to another process (a fork job), not to be run here. A store
   * that seals keeps it apart from the sessions it runs, for one {@link
   * IInteractiveSessionStore.exportHeld}, so a fork never pushes a running session out of what the
   * store holds.
   */
  readonly handoff?: boolean;
}

/** How an export is meant, which decides whether a store that seals hands a record over. */
export interface ISessionExportOptions {
  /**
   * The caller only checks that the record can be handed over (and how large it is) before the job
   * that takes it is started. A record a handoff save left stays for a later export, instead of
   * being handed over by this one.
   */
  readonly keep?: boolean;
}

/** One pass over a store: what {@link IInteractiveSessionStore.list} returns, and what it left out. */
export interface ISessionStoreScan {
  readonly entries: readonly ISessionListEntry[];
  /** How many sessions are present but `locked` because the keys are, so not among `entries`: an unlock lists them. */
  readonly locked: number;
  /**
   * How many sessions are present and sealed while this store holds no keys at all (`locked` with
   * the reason `no-keys`), so not among `entries` either; no unlock in this process lists them.
   * Absent when there are none, and from a store that does not tell them apart.
   */
  readonly noKeys?: number;
}

/** Persistence port for resumable interactive sessions. */
export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord, options?: ISessionSaveOptions): void;
  load(id: string, options?: ISessionLoadOptions): TSessionLoadOutcome;
  /**
   * Every session this store can describe. A sealed session whose keys are locked is not an entry
   * here — there is no record to show for it — and {@link scan} says how many were left out.
   */
  list(): readonly ISessionListEntry[];
  /**
   * The listing and the number of `locked` sessions it left out, from one pass, so a surface can say
   * "N sessions are locked" instead of letting them look gone without reading every file twice.
   * Optional: a store that never holds sealed records has nothing to leave out.
   */
  scan?(): ISessionStoreScan;
  /**
   * The record this store instance itself last wrote, or loaded to hold, while the stored file is
   * still exactly those bytes — what a process that is running a session needs to keep saving it
   * after `load` has started saying `locked`. `undefined` for any session it does not hold; `locked`
   * with the reason `changed` for one whose file has changed since. Optional: a store that never
   * seals has nothing to hold.
   */
  loadHeld?(id: string): TSessionLoadOutcome | undefined;
  /**
   * The sealed record of session `id` as an opaque token another store over the same files takes
   * with {@link importHeld}: the record a handoff save left here, while the file is still exactly
   * those bytes (handed over once, unless `keep` asks only to look), or else the record opened from
   * the file when the keys are unlocked. Opening for a token holds nothing. `undefined` when there is
   * nothing to hand over: a store that seals nothing (its records are readable from disk), or locked
   * keys and no handoff record. The token carries the conversation in plaintext, so it goes only
   * where the record may go.
   */
  exportHeld?(id: string, options?: ISessionExportOptions): string | undefined;
  /**
   * Takes a token from another store's {@link exportHeld} as a record this store holds, so a store
   * that cannot open the file (a write-only subagent process) can resume and keep saving the session
   * while the file is still the bytes the token names. Throws `TypeError` on a token this build does
   * not issue, one holding another session's record, and in a store that seals nothing, which would
   * write the record in plaintext over the sealed one.
   */
  importHeld?(id: string, token: string): void;
  delete(id: string): void;
}
