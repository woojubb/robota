/**
 * The persistence port for resumable interactive sessions, and the vocabulary its loads answer in.
 *
 * Split out of `session-contracts.ts` by TRANS-007: the port, its outcome union, its listing entry
 * and the decode-issue shape are one subject, and the file they were in is at its size ratchet.
 * It lives in this package rather than `agent-interface-transport` because ARCH-106 moved the
 * session contract family here; a store port is a session contract, and the owner map says so.
 */

import type { IInteractiveSessionRecord } from './session-contracts.js';
import type { TSessionAuthorship } from './session-authorship-contracts.js';

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
 *
 * A store that seals says, on every `valid` outcome, whose the record is (`authorship`), which stored
 * bytes it came from (`digest`), and whether it is the copy the store holds for a session it runs
 * rather than what is on disk now (`diverged`). A record that opens says nothing about who sealed it,
 * since sealing needs only the public key, so `verified` means the store can show the owner's unlocked
 * process wrote it. A store that never seals sets none of the three: absent `authorship` means a plain
 * store, never a trusted record.
 */
export type TSessionLoadOutcome =
  | {
      readonly status: 'valid';
      readonly record: IInteractiveSessionRecord;
      /** Whose the record is, from a store that seals; absent from a store that never seals. */
      readonly authorship?: TSessionAuthorship;
      /**
       * The SHA-256 (lowercase hex) of the stored bytes the record came from, which names exactly
       * what {@link ISessionAuthorship.adopt} raises. Absent for a record that came
       * from no single stored file (a project session rebuilt from its replay log).
       */
      readonly digest?: string;
      /**
       * The store answered with the copy it holds for a session it is running, because the file is
       * no longer those bytes and nothing shows the owner wrote what is there now. For display only.
       */
      readonly diverged?: true;
    }
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
 * Where the content a save writes came from, when the store cannot know it from what it read.
 * `owner`: content this process holds from the owner's own source (a session created here, or one
 * copied from a verified record). `unverified`: content from anywhere else.
 */
export type TSessionProvenance = 'owner' | 'unverified';

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
  /**
   * Where the content came from, for a store that seals. It can lower what the store holds for the
   * id, never raise it: `owner` counts only for an id the store holds nothing for and never handed
   * unverified content out for, and `unverified` makes any save untagged. Left out, a save of an id
   * the store holds nothing for is untagged. A store that never seals ignores it.
   */
  readonly provenance?: TSessionProvenance;
  /**
   * The claim this save is made under ({@link IInteractiveSessionStore.claim}). A save of a claimed id
   * must carry its live claim, and a claim that was released, or whose writer marker another process
   * broke, fences every later save made under it, so a session that outlived its claim cannot
   * overwrite the one that claimed the id after it.
   */
  readonly claim?: ISessionClaim;
}

/** How an export is meant, which decides whether a store that seals hands a record over. */
export interface ISessionExportOptions {
  /**
   * The caller only checks that the record can be handed over (and how large it is) before the job
   * that takes it is started. A record a handoff save left stays for a later export, instead of
   * being handed over by this one.
   */
  readonly keep?: boolean;
  /**
   * Hand over only the record a handoff save left here, while the file is still exactly its bytes —
   * never a record opened from the file, which anyone with the public key could have sealed. Nothing
   * is handed over when that copy is gone or the file changed.
   */
  readonly handoffOnly?: true;
}

/** How a claim is meant. */
export interface ISessionClaimOptions {
  /** The session is new: nothing is stored for it yet, and nothing on disk is taken for it. */
  readonly fresh?: true;
  /**
   * The nonce of a lease another process lent this id with ({@link IInteractiveSessionStore.lend}):
   * the claim takes that process's writer marker over instead of publishing its own, and is refused
   * when the marker no longer carries the lease.
   */
  readonly lease?: string;
  /**
   * The claim only reads the record to copy it into a session of a new id (`--fork-session`): it is
   * exclusive in this store as any claim is, takes no writer marker, and reads what was last saved,
   * so a session another process runs can still be copied.
   */
  readonly copy?: true;
}

/**
 * An id lent to another process for as long as that process runs it ({@link
 * IInteractiveSessionStore.lend}): the nonce that process claims the id with, and the end.
 */
export interface ISessionLease {
  /** What the borrowing process claims the id with (`claim(id, { lease: nonce })`); goes only to it. */
  readonly nonce: string;
  /**
   * Ends the lease: the writer marker is removed while it still carries this lease, whether it names
   * the lender or the process that took it over, and the id is no longer lent here. Idempotent.
   */
  end(): void;
}

/**
 * A running session's hold on its id ({@link IInteractiveSessionStore.claim}): the record the session
 * restores from, read in the same call that claimed it, and the release.
 */
export interface ISessionClaim {
  /** What the claim's read concluded; the session restores from this and reads nothing before it. */
  readonly outcome: TSessionLoadOutcome;
  /** Whether this exact claim still owns its writer marker; absent when the store cannot verify it. */
  holdsWriter?(): boolean;
  /** Ends this claim, and only this one: idempotent, and a late release never ends a later claim. */
  release(): void;
}

/**
 * What {@link ISessionAuthorship.adopt} did. `adopted`: the record with those bytes is the owner's from
 * now on. `pending`: it will be once the keys unlock (the stored bytes are tagged then, if they are
 * still those bytes). `changed`: nothing here has those bytes, so nothing was raised. `has_writer`:
 * another writer holds the id (a process it is lent to, or another session), and raising it would
 * write beside that writer, so nothing was raised.
 */
export type TSessionAdoptResult = 'adopted' | 'pending' | 'changed' | 'has_writer';

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
export type TSessionRestoreCommitOutcome =
  { readonly status: 'committed' } | { readonly status: 'unknown'; readonly error: unknown };

export interface IInteractiveSessionStore {
  save(session: IInteractiveSessionRecord, options?: ISessionSaveOptions): void;
  /**
   * Optional claimed restore commit: a successful return means the complete candidate was saved.
   * An unknown outcome means either the prior record or the complete candidate may be present;
   * neither may be overwritten by an assumed rollback. This operation must be synchronous,
   * claim-fenced and atomic with respect to the visible record. Stores without this guarantee
   * must omit it.
   */
  saveRestoreTransaction?(
    session: IInteractiveSessionRecord,
    options?: ISessionSaveOptions,
  ): TSessionRestoreCommitOutcome;
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
   * with the reason `changed` for one whose file has changed since. A store that rebuilds a session
   * from a replay log may also answer `missing` for a session that has no saved record and whose log
   * it cannot open now: for the writer there is nothing to protect, since a save writes the record
   * and leaves the log as it is. Optional: a store that never seals has nothing to hold.
   */
  loadHeld?(id: string): TSessionLoadOutcome | undefined;
  /**
   * The sealed record of session `id` as an opaque token another store over the same files takes
   * with {@link importHeld}: the record a handoff save left here, while the file is still exactly
   * those bytes (handed over once, unless `keep` asks only to look), or else the record opened from
   * the file when the keys are unlocked. Opening for a token holds nothing. `undefined` when there is
   * nothing to hand over: a store that seals nothing (its records are readable from disk), or locked
   * keys and no handoff record. The token carries the conversation in plaintext, so it goes only
   * where the record may go: to a write-only process the id is lent to ({@link lend}).
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
  /**
   * Claims session `id` for a session this process runs, and reads it as a hold read in the same call,
   * so nothing can change between the read the session restores from and the claim. A claim is
   * exclusive across every process and store instance over the same files: it holds the id's writer
   * marker beside the records, so a second claim — in this store, another store instance, or another
   * process — is refused with the reason `has_writer`, naming the process that holds it, and so is a
   * claim of an id this store lent. A claim fences every save of the id: a save must carry the live
   * claim, and one made under a claim that ended, or whose marker is no longer its own, is refused and
   * never written. Every other write of the id (a save without a claim, a delete, an adopt) holds the
   * marker for the write and is refused while another writer holds it. In a store that seals, a
   * claimed id is also answered only from content the owner wrote — the stored bytes the store holds,
   * a file whose authorship tag verifies, or the held copy, never other content from disk nor a
   * rebuild from a log — and a writer's read of a file changed by something unverifiable is `locked`
   * with the reason `changed`, so the session's save is refused and the file left as it is.
   */
  claim(id: string, options?: ISessionClaimOptions): ISessionClaim;
  /**
   * Lends session `id` to another process that will write it (a fork job's child): the id's writer
   * marker is published for this process with the digest of a fresh nonce, the id counts as written
   * here (a claim of it is refused, and {@link hasWriter} is true) until the lease ends, and the
   * process given the nonce claims the id with it, taking the marker over. Throws as {@link claim}
   * does while the id has a writer.
   */
  lend(id: string): ISessionLease;
  /**
   * Whether session `id` may have a writer now: a claim or a lend of this store, or a writer marker of
   * any other holder — another store instance, another process — whose owner is not provably gone. A
   * surface that would open the id as another session asks this first.
   */
  hasWriter(id: string): boolean;
  /**
   * What only a store that seals offers, since only its records carry an authorship; absent from a
   * store that never seals. A session gates on the outcome its claim read, never on this member, so a
   * view of the store that leaves it out loses adoption, not the gate.
   */
  readonly authorship?: ISessionAuthorship;
  delete(id: string): void;
}

/** The authorship operations of a store that seals ({@link IInteractiveSessionStore.authorship}). */
export interface ISessionAuthorship {
  /**
   * Raises the record whose stored bytes have SHA-256 `digest` to the owner's — the owner vouched for
   * exactly those bytes — and tags them when the keys allow, holding the id's writer marker for it.
   * Bytes that are not those raise nothing, and neither does an id another writer holds.
   */
  adopt(id: string, digest: string): TSessionAdoptResult;
  /**
   * The SHA-256 of the stored bytes this store instance last wrote, read to hold or was handed for
   * session `id`; `undefined` when it holds nothing for it. What a write-only child reports to its
   * parent after each save of the record it was handed, so the parent can vouch for exactly those bytes.
   */
  heldDigest(id: string): string | undefined;
  /**
   * Calls `listener` after each unlock of the keys this store opens with, so a session whose save the
   * locked keys stood in the way of can try it again. The listener may be held weakly: the caller keeps
   * its own reference for as long as it wants to hear unlocks. Returns the unsubscribe. An owner write
   * the locked keys could not tag is tagged at the unlock only while this store holds the id's writer
   * marker or can take it for the write; otherwise it stays untagged.
   */
  onUnlock(listener: () => void): () => void;
}
