/**
 * Where a store that seals decides whose each record is, and keeps it so (#3679).
 *
 * A file the same OS user can write is never a trust anchor. A sealed file that opens says it is
 * bound to this session's id and unaltered since it was sealed; it says nothing about who sealed it,
 * since anyone with the public key can. So whose a record is is decided when its bytes are opened —
 * an authorship tag only unlocked keys make (`session-record-authorship.ts`), bytes this instance
 * wrote from the owner's content, or bytes the owner adopted by their digest — and every `valid`
 * outcome says which. The ids a session in this process runs are claimed, and a claimed id is
 * answered only from content the owner wrote: unverified content from disk is never handed to it, so
 * nothing unverified can be merged into it, and a file something unverifiable changed is never
 * overwritten by it either. A save tags only content the store can vouch for; an owner save the
 * locked keys could not tag is tagged at the next unlock, unless a process it was handed to may still
 * be saving it. Adopting or tagging in place never replaces bytes another writer put there since.
 */

import { Buffer } from 'node:buffer';

import {
  isArtifactLockedError,
  isCurrentSealedArtifactBytes,
  isSealedArtifactBytes,
} from '@robota-sdk/agent-core';

import { SessionClaimedError } from './session-claims.js';
import { splitAuthorshipHeader, withAuthorshipHeader } from './session-record-authorship.js';
import { SealedSessionUnreadableError } from './sealed-session-refusal.js';
import { formatHeldToken, parseHeldToken } from './sealed-session-memory.js';
import {
  DOES_NOT_OPEN_MESSAGE,
  bytesOf,
  decodeRecordText,
  digestOf,
  isSha256Hex,
  recordContext,
  sameBytes,
  utf8Text,
} from './stored-session-codec.js';

import type { SessionClaims } from './session-claims.js';
import type {
  IRememberedRecord,
  ISessionRecordState,
  SealedSessionMemory,
  THeldRecordKind,
} from './sealed-session-memory.js';
import type { TStoredSessionFile } from './stored-session-codec.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type {
  ISessionExportOptions,
  ISessionSaveOptions,
  TSessionAdoptResult,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/** Every read a store makes of a record, and the check before a save. */
export type TReadPurpose =
  /** A load that only looks: a report, an existence check, an attach. */
  | 'probe'
  /** A load that holds: a resume or a writer about to save. */
  | 'hold'
  /** One entry of a listing; no writer merges it. */
  | 'list'
  /** The held copy a writer asks for once `load` says `locked`. */
  | 'held'
  /** A record handed to another process as a token. */
  | 'export'
  /** The read a claim makes, which the session restores from. */
  | 'claim'
  /** The check before a save replaces the file. */
  | 'save';

/** What a read of each purpose may do. */
interface IReadPurpose {
  /** It feeds a writer, so a claimed id is never answered with content it cannot vouch for. */
  readonly writer: boolean;
  /** It takes a handoff record into the memory of the sessions the store runs. */
  readonly takes: boolean;
  /** It remembers what it opened. */
  readonly holds: boolean;
  /** Unverified content it hands out taints the id: a writer could merge from it. */
  readonly taints: boolean;
}

const READ_PURPOSES: Readonly<Record<TReadPurpose, IReadPurpose>> = {
  probe: { writer: false, takes: false, holds: false, taints: true },
  hold: { writer: true, takes: true, holds: true, taints: true },
  list: { writer: false, takes: false, holds: false, taints: false },
  held: { writer: true, takes: true, holds: false, taints: true },
  export: { writer: true, takes: false, holds: false, taints: true },
  claim: { writer: true, takes: true, holds: true, taints: true },
  save: { writer: true, takes: false, holds: false, taints: false },
};

/** How the store reads and replaces a record's file; see `IStoredSessionFiles`. */
export interface IAuthorshipFiles {
  current(id: string): TStoredSessionFile;
  replace(id: string, stored: Uint8Array): void;
}

/** The bytes a save writes, and what the store holds them as once written. */
export interface IPreparedSave {
  readonly stored: Uint8Array;
  readonly text: string;
  readonly heldAs: THeldRecordKind;
  /** An owner write the locked keys could not tag, to be tagged at the next unlock if still in place. */
  readonly tagPending: boolean;
}

/** The envelope a sealed file holds and whether its authorship tag verifies, or why this process cannot get it. */
type TOpened =
  | { readonly kind: 'text'; readonly text: string; readonly verified: boolean }
  | { readonly kind: 'locked' }
  | { readonly kind: 'no-keys' }
  | { readonly kind: 'does-not-open' };

/** A sealed file a process without keys meets: intact, and no key in this process opens it. */
export const NO_KEYS_OUTCOME: TSessionLoadOutcome = Object.freeze({
  status: 'locked',
  reason: 'no-keys',
});
/** A session this instance holds whose file is no longer the bytes it wrote or read. */
const CHANGED_OUTCOME: TSessionLoadOutcome = Object.freeze({ status: 'locked', reason: 'changed' });
/** A sealed file the locked keys cannot open: whether it is the owner's is decided at unlock. */
const LOCKED_OUTCOME: TSessionLoadOutcome = Object.freeze({ status: 'locked' });
export const MISSING_OUTCOME: TSessionLoadOutcome = Object.freeze({ status: 'missing' });

type TValid = Extract<TSessionLoadOutcome, { status: 'valid' }>;

/** `outcome` with whose it is, which bytes it came from, and whether it is a held copy. */
function annotated(
  outcome: TValid,
  verified: boolean,
  digest: string | undefined,
  diverged: boolean,
): TSessionLoadOutcome {
  return {
    status: 'valid',
    record: outcome.record,
    authorship: verified ? 'verified' : 'unverified',
    ...(digest === undefined ? {} : { digest }),
    ...(diverged ? { diverged: true as const } : {}),
  };
}

/** Opens a current-framing sealed file, wiping the plaintext buffer once it is turned into text. */
function openSealed(sealer: IArtifactSealer, id: string, stored: Uint8Array): TOpened {
  let plain: Uint8Array;
  try {
    plain = sealer.openBytes(stored, recordContext(id));
  } catch (error) {
    // A write-only sealer (a process handed only a write grant) holds no keys.
    if (isArtifactLockedError(error)) {
      return (error as { readonly reason?: unknown }).reason === 'no-keys'
        ? { kind: 'no-keys' }
        : { kind: 'locked' };
    }
    // Any other failure of the sealer is no evidence the file is fine, and it must neither take a
    // listing down nor read as an absent file: it is reported as a file that does not open.
    return { kind: 'does-not-open' };
  }
  try {
    // The one place a record's authorship header is taken off: what is held, decoded or handed
    // over from here on is the envelope alone.
    const { envelope, tag } = splitAuthorshipHeader(plain);
    let verified = false;
    if (tag instanceof Uint8Array && sealer.verifyAuthorship !== undefined) {
      try {
        verified = sealer.verifyAuthorship(envelope, tag, recordContext(id)) === true;
      } catch {
        // allow-fallback: a check that cannot run shows nothing, and nothing shown is unverified.
        verified = false;
      }
    }
    return { kind: 'text', text: utf8Text(envelope), verified };
  } finally {
    plain.fill(0);
  }
}

/**
 * What the bytes of session `id` say to a store that seals with `sealer` and holds nothing yet: the
 * outcome, owner's only when the tag verifies. Stateless; a migration reads with it.
 */
export function openStoredSessionRecord(
  id: string,
  stored: Uint8Array,
  sealer: IArtifactSealer,
): TSessionLoadOutcome {
  let text: string;
  let verified = false;
  if (!isSealedArtifactBytes(stored)) {
    text = utf8Text(stored);
  } else {
    if (!isCurrentSealedArtifactBytes(stored))
      return { status: 'unsupported', schemaVersion: undefined };
    const opened = openSealed(sealer, id, stored);
    if (opened.kind === 'locked') return LOCKED_OUTCOME;
    if (opened.kind === 'no-keys') return NO_KEYS_OUTCOME;
    if (opened.kind === 'does-not-open') {
      return { status: 'corrupt', issues: [{ path: '', message: DOES_NOT_OPEN_MESSAGE }] };
    }
    text = opened.text;
    verified = opened.verified;
  }
  const outcome = decodeRecordText(id, text);
  return outcome.status === 'valid'
    ? annotated(outcome, verified, digestOf(stored), false)
    : outcome;
}

/** The authorship of one store that seals; see the module documentation. */
export class StoredSessionAuthorship {
  readonly #sealer: IArtifactSealer;
  readonly #files: IAuthorshipFiles;
  readonly #memory: SealedSessionMemory;
  readonly #claims: SessionClaims;
  /** Held here so the sealer may hold it weakly: it lives exactly as long as this object. */
  readonly #onUnlock: (() => void) | undefined;

  constructor(
    sealer: IArtifactSealer,
    files: IAuthorshipFiles,
    memory: SealedSessionMemory,
    claims: SessionClaims,
  ) {
    this.#sealer = sealer;
    this.#files = files;
    this.#memory = memory;
    this.#claims = claims;
    if (sealer.tagAuthorship !== undefined && sealer.onUnlock !== undefined) {
      this.#onUnlock = () => this.#tagPendingAtUnlock();
      sealer.onUnlock(this.#onUnlock);
    }
  }

  /**
   * One read of session `id` for `purpose`. A claimed, handed-off or pinned id is answered only from
   * content the owner wrote (see {@link guarded}), before any rebuild an absent file would otherwise
   * get; any other id is what its bytes say, and a rebuild from a log is never the owner's.
   */
  read(
    id: string,
    file: TStoredSessionFile,
    unreadable: TSessionLoadOutcome,
    rebuild: () => TSessionLoadOutcome,
    purpose: TReadPurpose,
  ): TSessionLoadOutcome {
    const guarded = this.guarded(id, file, purpose);
    if (guarded !== undefined) return guarded;
    if (file.kind === 'absent') {
      const rebuilt = rebuild();
      // A rebuild from a log carries no tag and comes from no single stored file.
      return rebuilt.status === 'valid'
        ? this.#handOut(id, rebuilt, 'unverified', undefined, purpose, false)
        : rebuilt;
    }
    const bytes = bytesOf(file);
    return bytes === undefined ? unreadable : this.decode(id, bytes, purpose);
  }

  /** What the stored bytes of session `id` say, for `purpose`; whose they are by tag or by what is held. */
  decode(id: string, stored: Uint8Array, purpose: TReadPurpose): TSessionLoadOutcome {
    let text: string;
    let verified = false;
    if (!isSealedArtifactBytes(stored)) {
      text = utf8Text(stored);
    } else {
      if (!isCurrentSealedArtifactBytes(stored)) {
        return { status: 'unsupported', schemaVersion: undefined };
      }
      const opened = openSealed(this.#sealer, id, stored);
      if (opened.kind === 'locked') return LOCKED_OUTCOME;
      if (opened.kind === 'no-keys') return NO_KEYS_OUTCOME;
      if (opened.kind === 'does-not-open') {
        return { status: 'corrupt', issues: [{ path: '', message: DOES_NOT_OPEN_MESSAGE }] };
      }
      text = opened.text;
      verified = opened.verified;
    }
    const outcome = decodeRecordText(id, text);
    if (outcome.status !== 'valid') return outcome;
    const digest = digestOf(stored);
    const state = this.#memory.state(id);
    const kind = verified || this.#isOwners(state, state?.held, digest) ? 'owner' : 'unverified';
    if (READ_PURPOSES[purpose].holds) this.#memory.hold(id, { digest, text, kind });
    return this.#handOut(id, outcome, kind, digest, purpose, false);
  }

  /**
   * The claim's own read: a resumed id this instance already holds exactly the bytes of is answered
   * from them; anything else is read as {@link read} reads a claim.
   */
  claimRead(
    id: string,
    fresh: boolean,
    file: TStoredSessionFile,
    unreadable: TSessionLoadOutcome,
    rebuild: () => TSessionLoadOutcome,
  ): TSessionLoadOutcome {
    const held = this.#memory.state(id)?.held;
    const bytes = bytesOf(file);
    if (!fresh && held !== undefined && bytes !== undefined && digestOf(bytes) === held.digest) {
      return this.#heldOutcome(id, held, 'claim', false);
    }
    return this.read(id, file, unreadable, rebuild, 'claim');
  }

  /**
   * Readies `id` for a claim: refused for a record a write-only child holds as handed to it, and for
   * one handed to another process that may still save it, so no session here becomes its second
   * writer; for a new session whatever this instance remembered under its id is not that session's.
   */
  beforeClaim(id: string, fresh: boolean): void {
    const state = this.#memory.state(id);
    if (state?.held?.kind === 'pinned') throw new SessionClaimedError(id, 'claimed');
    if (state?.exported === true) throw new SessionClaimedError(id, 'exported');
    if (fresh) {
      this.#memory.dropHeld(id);
      this.#memory.dropHandoff(id);
    }
  }

  /**
   * The answer for an id this store holds for a session it runs — claimed, pinned, or a handoff record
   * not yet handed over — or `undefined` for any other id. Every read of such an id answers the same
   * way, before any rebuild an absent file would otherwise get:
   *
   * - the file is exactly the held bytes, or (claimed only) opens with an authorship tag that
   *   verifies, as another of the owner's unlocked processes wrote it: that content;
   * - the file is gone: `missing` when nothing is held yet (a fresh claim), otherwise the held copy —
   *   a re-create writes only the owner's content;
   * - anything else — plain, untagged, a tag that does not verify, a sealed file the locked keys cannot
   *   open: a writer's read is `locked` (with the reason `changed`, or none when only the locked keys
   *   stand in the way and an unlock may show the owner wrote it), so the save is refused and the file
   *   left as it is; a probe or listing gets the held copy marked `diverged`, for display only.
   *
   * A handoff record is answered from its copy or as `changed`, and a writer's read takes it over.
   */
  guarded(
    id: string,
    file: TStoredSessionFile,
    purpose: TReadPurpose,
  ): TSessionLoadOutcome | undefined {
    const state = this.#memory.state(id);
    const runHere = this.#isRunHere(id, state);
    const handoff = runHere ? undefined : state?.handoff;
    if (!runHere && handoff === undefined) return undefined;
    const use = READ_PURPOSES[purpose];
    const bytes = bytesOf(file);
    const digest = bytes === undefined ? undefined : digestOf(bytes);
    if (handoff !== undefined) {
      if (use.takes) this.#memory.dropHandoff(id);
      if (bytes === undefined || digest !== handoff.digest) return CHANGED_OUTCOME;
      if (use.takes) this.#memory.hold(id, handoff);
      return this.#heldOutcome(id, handoff, purpose, false);
    }
    const entry = state?.held;
    if (entry !== undefined && digest === entry.digest) {
      return this.#heldOutcome(id, entry, purpose, false);
    }
    let lockedOnly = false;
    if (
      entry?.kind !== 'pinned' &&
      file.kind === 'sealed' &&
      isCurrentSealedArtifactBytes(file.bytes)
    ) {
      const opened = openSealed(this.#sealer, id, file.bytes);
      if (opened.kind === 'text' && opened.verified && digest !== undefined) {
        const outcome = decodeRecordText(id, opened.text);
        if (outcome.status === 'valid') {
          if (purpose !== 'save')
            this.#memory.hold(id, { digest, text: opened.text, kind: 'owner' });
          return annotated(outcome, true, digest, false);
        }
      }
      lockedOnly = opened.kind === 'locked';
    }
    if (file.kind === 'absent') {
      return entry === undefined ? MISSING_OUTCOME : this.#heldOutcome(id, entry, purpose, true);
    }
    if (use.writer || entry === undefined) return lockedOnly ? LOCKED_OUTCOME : CHANGED_OUTCOME;
    return this.#heldOutcome(id, entry, purpose, true);
  }

  /**
   * Throws {@link SealedSessionUnreadableError} unless `existing` may be replaced by a save: a run-here
   * id's file when it is exactly what is held, verifies or is gone (see {@link guarded}); any other
   * id's when it is absent, plain, exactly the bytes this instance last wrote or holds, or a sealed
   * file this store opens.
   */
  assertReplaceable(id: string, existing: TStoredSessionFile): void {
    const guarded = this.guarded(id, existing, 'save');
    if (guarded !== undefined) {
      if (guarded.status !== 'locked') return;
      throw new SealedSessionUnreadableError(
        id,
        guarded.reason === 'changed' ? 'changed' : 'locked',
      );
    }
    switch (existing.kind) {
      case 'absent':
      case 'plain':
        return;
      case 'unreadable':
      case 'oversized':
        // Nothing past the read limit can be shown to be anything, and it may be a sealed session.
        throw new SealedSessionUnreadableError(id, 'unreadable');
      case 'sealed':
        break;
    }
    const bytes = existing.bytes;
    if (!isCurrentSealedArtifactBytes(bytes)) {
      throw new SealedSessionUnreadableError(id, 'newer-format');
    }
    // Checked first, since it needs no keys and no decryption.
    const held = this.#memory.state(id)?.held;
    if (held !== undefined && held.digest === digestOf(bytes)) return;
    const opened = openSealed(this.#sealer, id, bytes);
    if (opened.kind === 'text') return;
    throw new SealedSessionUnreadableError(
      id,
      held !== undefined
        ? 'changed'
        : opened.kind === 'locked' || opened.kind === 'no-keys'
          ? opened.kind
          : 'does-not-open',
    );
  }

  /**
   * The sealed bytes a save of envelope `text` for `id` writes. Tagged only when the store can vouch
   * for the content and the keys are unlocked: the id is held as the owner's, or it is held as
   * nothing, was never handed out unverified, and the save says its content is the owner's
   * (`provenance`). An owner save while locked is written untagged and tagged at the next unlock if it
   * is still in place — unless it is a handoff save or the id was exported to a process that may still
   * save it. Every other save is untagged, and a pinned record is never tagged.
   */
  prepare(id: string, text: string, options: ISessionSaveOptions): IPreparedSave {
    const envelope = Buffer.from(text, 'utf8');
    const heldAs = this.#kindOfSave(id, options);
    let plaintext: Buffer = envelope;
    let tagPending = false;
    if (heldAs === 'owner') {
      const tag = this.#tag(id, envelope);
      if (tag === 'locked') {
        tagPending = options.handoff !== true && this.#memory.state(id)?.exported !== true;
      } else if (tag !== undefined) {
        plaintext = withAuthorshipHeader(tag, envelope);
      }
    }
    try {
      return {
        stored: this.#sealer.sealBytes(plaintext, recordContext(id)),
        text,
        heldAs,
        tagPending,
      };
    } finally {
      if (plaintext !== envelope) plaintext.fill(0);
    }
  }

  /**
   * Records that `prepared` is now at session `id`'s path, so the next save recognises it as its own.
   * A handoff write is kept apart, for one export: the record is another process's to run.
   */
  wrote(id: string, prepared: IPreparedSave, handoff: boolean): void {
    const prior = this.#memory.state(id)?.held;
    // A write-only child's own saves continue the record it was handed, on the same word.
    const vouched = prepared.heldAs === 'pinned' && prior?.kind === 'pinned' && prior.vouched;
    const record: IRememberedRecord = {
      digest: digestOf(prepared.stored),
      text: prepared.text,
      kind: prepared.heldAs,
      ...(vouched === true ? { vouched } : {}),
    };
    if (handoff && !this.#claims.has(id) && prepared.heldAs !== 'pinned') {
      this.#memory.dropHeld(id);
      this.#memory.holdHandoff(id, record);
    } else {
      this.#memory.dropHandoff(id);
      this.#memory.hold(id, record);
    }
    if (prepared.tagPending) this.#memory.setPending(id, record.digest);
    else this.#memory.clearPending(id);
  }

  /** {@link wrote} after a write that threw, only when `existing` is exactly its bytes. */
  wroteIfPresent(
    id: string,
    prepared: IPreparedSave,
    existing: TStoredSessionFile,
    handoff: boolean,
  ): void {
    if (existing.kind === 'sealed' && sameBytes(existing.bytes, prepared.stored)) {
      this.wrote(id, prepared, handoff);
    }
  }

  /**
   * The record this instance last wrote or holds, for a writer whose `load` said `locked`: offered only
   * while `existing` is exactly those bytes; `changed` when it holds the id and the file moved on. A
   * run-here id is answered as every read of it is, and a handoff record a writer asks for is taken over.
   */
  held(id: string, existing: TStoredSessionFile): TSessionLoadOutcome | undefined {
    const guarded = this.guarded(id, existing, 'held');
    if (guarded !== undefined) return guarded;
    const entry = this.#memory.state(id)?.held;
    if (entry === undefined) return undefined;
    const bytes = bytesOf(existing);
    if (bytes === undefined || digestOf(bytes) !== entry.digest) return CHANGED_OUTCOME;
    return this.#heldOutcome(id, entry, 'held', false);
  }

  /**
   * The record of session `id` as a token for another store over the same files, carrying the
   * envelope only: a handoff record while `existing` is still its bytes (handed over once, or left in
   * place with `keep`), or else — unless `handoffOnly` — the record opened from `existing`, a probe that
   * holds nothing. A run-here id's token is only what the owner wrote. An id handed over is not tagged
   * or adopted while the process it went to may still be saving it.
   */
  exportHeld(
    id: string,
    existing: TStoredSessionFile,
    options: ISessionExportOptions,
  ): string | undefined {
    if (existing.kind !== 'sealed' || !isCurrentSealedArtifactBytes(existing.bytes))
      return undefined;
    const digest = digestOf(existing.bytes);
    const handOver = (text: string, kind: THeldRecordKind): string => {
      if (options.keep !== true) this.#memory.setExported(id, true);
      return formatHeldToken(digest, text, kind === 'owner');
    };
    const state = this.#memory.state(id);
    if (this.#isRunHere(id, state)) {
      if (options.handoffOnly === true) return undefined;
      const outcome = this.guarded(id, existing, 'export');
      const entry = this.#memory.state(id)?.held;
      if (outcome?.status !== 'valid' || outcome.diverged === true || entry?.digest !== digest) {
        return undefined;
      }
      return handOver(entry.text, outcome.authorship === 'verified' ? 'owner' : 'unverified');
    }
    const handoff = state?.handoff;
    if (handoff !== undefined) {
      if (options.keep !== true) this.#memory.dropHandoff(id);
      if (handoff.digest !== digest) return undefined;
      this.#handedOut(id, handoff.kind, 'export');
      return handOver(handoff.text, handoff.kind);
    }
    if (options.handoffOnly === true) return undefined;
    const opened = openSealed(this.#sealer, id, existing.bytes);
    if (opened.kind !== 'text' || decodeRecordText(id, opened.text).status !== 'valid') {
      return undefined;
    }
    const kind =
      opened.verified || this.#isOwners(state, state?.held, digest) ? 'owner' : 'unverified';
    this.#handedOut(id, kind, 'export');
    return handOver(opened.text, kind);
  }

  /**
   * Holds the record a token carries as pinned: every read of the id answers only from it and this
   * instance's own later writes, and a save may replace exactly the bytes the token names. Throws
   * `TypeError` (fixed text) for a token this build does not issue or one that does not hold a valid
   * record of session `id`, and {@link SessionClaimedError} for an id a session here has claimed.
   */
  importHeld(id: string, token: string): void {
    const parsed = parseHeldToken(token);
    if (parsed === undefined) {
      throw new TypeError('The held record is not a token this build issues.');
    }
    if (decodeRecordText(id, parsed.text).status !== 'valid') {
      throw new TypeError('The held record is not a valid record of this session.');
    }
    this.#claims.assertUnclaimed(id);
    this.#memory.dropHandoff(id);
    this.#memory.hold(id, {
      digest: parsed.digest,
      text: parsed.text,
      kind: 'pinned',
      ...(parsed.owner ? { vouched: true as const } : {}),
    });
  }

  /**
   * Raises the record of session `id` whose stored bytes have SHA-256 `digest` to the owner's, and
   * clears the id's taint:
   *
   * 1. This instance holds those bytes (a resume the owner accepted): they are held as the owner's
   *    from now on, and tagged in place while the file is still them — at the next unlock when the keys
   *    are locked (`pending`). A file that changed since is not touched; a claimed id is answered with
   *    the adopted copy and its next save writes it.
   * 2. It holds nothing for them and the file is exactly them (a fork record a child wrote): they are
   *    tagged in place, or at the next unlock (`pending`), and nothing is held for them here.
   * 3. Otherwise nothing is raised (`changed`), and a record exported to a process that may still save
   *    it is never raised under it (`exported`).
   */
  adopt(id: string, digest: string): TSessionAdoptResult {
    if (!isSha256Hex(digest)) return 'changed';
    const state = this.#memory.state(id);
    if (state?.exported === true) return 'exported';
    const file = this.#files.current(id);
    const bytes = bytesOf(file);
    const onDisk = bytes === undefined ? undefined : digestOf(bytes);
    const entry = state?.held;
    if (entry !== undefined && entry.digest === digest && entry.kind !== 'pinned') {
      this.#memory.hold(id, { ...entry, kind: 'owner' });
      this.#memory.untaint(id);
      if (onDisk !== digest) return 'adopted';
      // The bytes are raised in memory whether or not the file is still them when the tag is written.
      return this.#tagInPlace(id, digest, entry.text, true) === 'pending' ? 'pending' : 'adopted';
    }
    if (bytes === undefined || onDisk !== digest || this.#sealer.tagAuthorship === undefined) {
      return 'changed';
    }
    const text = this.#textOfFile(id, file, bytes);
    if (text === 'locked') {
      this.#memory.untaint(id);
      this.#memory.setPending(id, digest);
      return 'pending';
    }
    if (text === undefined || decodeRecordText(id, text).status !== 'valid') return 'changed';
    const result = this.#tagInPlace(id, digest, text, false);
    if (result !== 'changed') this.#memory.untaint(id);
    return result;
  }

  /** The digest of the bytes this instance holds for `id`, or `undefined`. */
  heldDigest(id: string): string | undefined {
    return this.#memory.state(id)?.held?.digest;
  }

  /**
   * Whether `id` has a writer no claim here stands for: the process it was exported to, until that
   * export ends, or — in the write-only child it was handed to — the child's own session.
   */
  hasUnclaimedWriter(id: string): boolean {
    const state = this.#memory.state(id);
    return state?.exported === true || state?.held?.kind === 'pinned';
  }

  /** The process `id` was exported to has ended: it may be adopted or tagged again. */
  exportEnded(id: string): void {
    this.#memory.setExported(id, false);
  }

  /** Forgets the id's records, pending tag and export: the session was deleted. */
  forget(id: string): void {
    this.#memory.forget(id);
  }

  /** Subscribes `listener` to the unlocks of this store's keys (held as weakly as the sealer holds it). */
  onUnlock(listener: () => void): () => void {
    return this.#sealer.onUnlock?.(listener) ?? (() => undefined);
  }

  /** Whether a session in this process runs `id`: claimed, or held pinned by a write-only child. */
  #isRunHere(id: string, state: ISessionRecordState | undefined): boolean {
    return this.#claims.has(id) || state?.held?.kind === 'pinned';
  }

  /**
   * Whether bytes `digest` of an id are the owner's by what this store holds for it: `record` is held
   * as the owner's with those bytes, or those are owner bytes waiting for a tag. The one place that
   * says so; a tag that verifies says so on its own.
   */
  #isOwners(
    state: ISessionRecordState | undefined,
    record: IRememberedRecord | undefined,
    digest: string,
  ): boolean {
    return (
      state?.pendingDigest === digest || (record?.kind === 'owner' && record.digest === digest)
    );
  }

  /** The record `entry` holds, as an outcome of a read for `purpose`. */
  #heldOutcome(
    id: string,
    entry: IRememberedRecord,
    purpose: TReadPurpose,
    diverged: boolean,
  ): TSessionLoadOutcome {
    const outcome = decodeRecordText(id, entry.text);
    if (outcome.status !== 'valid') return outcome;
    if (entry.kind === 'pinned') {
      // A write-only child's record is the owner's to it only on the word of the process that
      // handed it over; it is run here, so handing it out taints nothing.
      return annotated(outcome, entry.vouched === true, entry.digest, diverged);
    }
    const kind = this.#isOwners(this.#memory.state(id), entry, entry.digest)
      ? 'owner'
      : 'unverified';
    return this.#handOut(id, outcome, kind, entry.digest, purpose, diverged);
  }

  /** `outcome` annotated, and the id tainted when unverified content leaves for a writer of an id not run here. */
  #handOut(
    id: string,
    outcome: TValid,
    kind: THeldRecordKind,
    digest: string | undefined,
    purpose: TReadPurpose,
    diverged: boolean,
  ): TSessionLoadOutcome {
    this.#handedOut(id, kind, purpose);
    return annotated(outcome, kind === 'owner', digest, diverged);
  }

  #handedOut(id: string, kind: THeldRecordKind, purpose: TReadPurpose): void {
    if (
      kind !== 'owner' &&
      READ_PURPOSES[purpose].taints &&
      !this.#isRunHere(id, this.#memory.state(id))
    ) {
      this.#memory.taint(id);
    }
  }

  /** Whose a save of `id` writes (see {@link prepare}). */
  #kindOfSave(id: string, options: ISessionSaveOptions): THeldRecordKind {
    const state = this.#memory.state(id);
    const entry = state?.held ?? state?.handoff;
    if (entry?.kind === 'pinned') return 'pinned';
    if (options.provenance === 'unverified') return 'unverified';
    // A claimed id's saves come only from the session that claimed it, whose content no read of the
    // id ever mixed with unverified content; any other writer may have merged what a read handed out.
    if (!this.#claims.has(id) && state?.tainted === true) return 'unverified';
    if (entry !== undefined) return entry.kind;
    return options.provenance === 'owner' ? 'owner' : 'unverified';
  }

  /** The authorship tag of `envelope` for `id`; `locked` while the keys are; `undefined` when this sealer cannot tag. */
  #tag(id: string, envelope: Uint8Array): Uint8Array | 'locked' | undefined {
    if (this.#sealer.tagAuthorship === undefined) return undefined;
    try {
      return this.#sealer.tagAuthorship(envelope, recordContext(id));
    } catch (error) {
      if (isArtifactLockedError(error)) return 'locked';
      throw error;
    }
  }

  /** The envelope a file of `id` holds; `locked` while the keys are; `undefined` when it does not open. */
  #textOfFile(
    id: string,
    file: TStoredSessionFile,
    bytes: Uint8Array,
  ): string | 'locked' | undefined {
    if (file.kind !== 'sealed') return utf8Text(bytes);
    if (!isCurrentSealedArtifactBytes(bytes)) return undefined;
    const opened = openSealed(this.#sealer, id, bytes);
    if (opened.kind === 'locked') return 'locked';
    return opened.kind === 'text' ? opened.text : undefined;
  }

  /**
   * Re-seals `text` with a tag over the file of `id`, which held the owner's bytes `digest`; while
   * locked, it is tagged at the next unlock instead (`pending`); `changed` when the file is no longer
   * those bytes by the time the tag is written. With `hold`, this instance holds the new bytes.
   */
  #tagInPlace(id: string, digest: string, text: string, hold: boolean): TSessionAdoptResult {
    const envelope = Buffer.from(text, 'utf8');
    const tag = this.#tag(id, envelope);
    if (tag === 'locked') {
      this.#memory.setPending(id, digest);
      return 'pending';
    }
    if (tag === undefined) return 'adopted';
    return this.#writeTagged(id, envelope, text, tag, digest, hold) ? 'adopted' : 'changed';
  }

  /**
   * Writes `text` sealed with `tag` over the file of `id` — only while the file is still the bytes
   * `expected`, read again immediately before the write, so a newer write by another of the owner's
   * processes since the check is never replaced with these older bytes. Returns whether it wrote.
   */
  #writeTagged(
    id: string,
    envelope: Uint8Array,
    text: string,
    tag: Uint8Array,
    expected: string,
    hold: boolean,
  ): boolean {
    const plaintext = withAuthorshipHeader(tag, envelope);
    let stored: Uint8Array;
    try {
      stored = this.#sealer.sealBytes(plaintext, recordContext(id));
    } finally {
      plaintext.fill(0);
    }
    const now = bytesOf(this.#files.current(id));
    if (now === undefined || digestOf(now) !== expected) return false;
    const prepared: IPreparedSave = { stored, text, heldAs: 'owner', tagPending: false };
    try {
      this.#files.replace(id, stored);
    } catch (error) {
      if (hold) this.wroteIfPresent(id, prepared, this.#files.current(id), false);
      throw error;
    }
    this.#memory.clearPending(id);
    if (hold) this.wrote(id, prepared, false);
    return true;
  }

  /**
   * At unlock: tags, synchronously, every owner write and deferred adopt that waited for the keys,
   * while its file is still exactly those bytes, and drops each either way. An id exported to a child
   * is skipped, since tagging would change the bytes the child holds and refuse its saves.
   */
  #tagPendingAtUnlock(): void {
    for (const [id, digest] of this.#memory.pending()) {
      this.#memory.clearPending(id);
      if (this.#memory.state(id)?.exported === true) continue;
      try {
        const file = this.#files.current(id);
        const bytes = bytesOf(file);
        if (bytes === undefined || digestOf(bytes) !== digest) continue;
        const entry = this.#memory.state(id)?.held;
        const hold = entry?.digest === digest;
        const text = hold ? entry.text : this.#textOfFile(id, file, bytes);
        if (text === undefined || text === 'locked') continue;
        if (decodeRecordText(id, text).status !== 'valid') continue;
        const envelope = Buffer.from(text, 'utf8');
        const tag = this.#tag(id, envelope);
        if (!(tag instanceof Uint8Array)) continue;
        this.#writeTagged(id, envelope, text, tag, digest, hold);
      } catch {
        // allow-fallback: one record's failure must not stop the others; its next owner save tags it.
      }
    }
  }
}
