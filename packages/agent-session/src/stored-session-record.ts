/**
 * The one place both session stores (the user's directory and the trusted project's) keep their
 * records through, so they cannot disagree about what a file means. A record is stored in one of two
 * forms:
 *
 * - plain: the versioned JSON envelope, or
 * - sealed: the same JSON bytes sealed by an {@link IArtifactSealer}, bound to the record's own id.
 *
 * A store that seals WRITES sealed and reads both, so a directory part-way through a migration lists
 * correctly and a plain record turns sealed the next time its session is saved. A store that seals
 * nothing writes plain and meets a sealed file as `locked`: this process cannot read it, which is a
 * different fact from "damaged" and from "not there".
 *
 * A save over a sealed file this store cannot open goes ahead only when the file is provably exactly
 * the bytes it last wrote or holds (`sealed-session-memory.ts`); anything else on disk is a session
 * this instance never held, or one that changed since, and is not replaced. Every store claims the
 * ids its sessions run (`session-claims.ts`), exclusively across processes and fencing their saves,
 * and every write of an id holds the id's writer marker, the claim's own or one taken for the write;
 * a store that seals also decides and keeps whose each record is (`stored-session-authorship.ts`).
 */

import { createHash, randomBytes } from 'node:crypto';

import { isCurrentSealedArtifactBytes, isSealedArtifactBytes } from '@robota-sdk/agent-core';

import { SealedSessionUnreadableError } from './sealed-session-refusal.js';
import { SealedSessionMemory } from './sealed-session-memory.js';
import { SessionClaims, isSessionClaimedError, writerHolderOf } from './session-claims.js';
import { assertSafeSessionId } from './session-id.js';
import {
  MISSING_OUTCOME,
  NO_KEYS_OUTCOME,
  StoredSessionAuthorship,
} from './stored-session-authorship.js';
import {
  bytesOf,
  decodeRecordText,
  encodeStoredSession,
  envelopeText,
  utf8Text,
} from './stored-session-codec.js';

import type { ISessionClaimRefusalWords } from './session-claims.js';
import type { TReadPurpose } from './stored-session-authorship.js';
import type { TStoredSessionFile } from './stored-session-codec.js';
import type {
  IArtifactSealer,
  IProcessMarkerHandle,
  IProcessMarkers,
  TArtifactSealing,
} from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  ISessionAuthorship,
  ISessionClaim,
  ISessionClaimOptions,
  ISessionExportOptions,
  ISessionLease,
  ISessionLoadOptions,
  ISessionSaveOptions,
  TSessionAdoptResult,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/**
 * How a session store is built. `sealing` is required: every store states whether it keeps its
 * records sealed or plain, because a store that silently kept them plain beside sealed ones would
 * write plaintext next to them. A host that seals states it for every store it builds.
 * `releaseCommand` is the host's command that releases a writer marker whose holder is not running,
 * for a `has_writer` refusal to name; without it the refusal names none.
 */
export interface ISessionStoreOptions extends ISessionClaimRefusalWords {
  readonly sealing: TArtifactSealing;
}

/** The writer markers of a store's `claims` directory, which every store is built with. */
function assertProcessMarkers(value: unknown): asserts value is IProcessMarkers {
  const markers = value as Partial<IProcessMarkers> | null | undefined;
  if (
    typeof markers?.acquire !== 'function' ||
    typeof markers.takeOver !== 'function' ||
    typeof markers.endLease !== 'function' ||
    typeof markers.inspect !== 'function'
  ) {
    throw new TypeError(
      'A session store holds a writer marker for every id it writes: build it with the markers of its claims directory.',
    );
  }
}

/** The sealing `options` state; one that is not a {@link TArtifactSealing} (a call that ignores the types) is refused. */
export function sessionSealingOf(options: ISessionStoreOptions): TArtifactSealing {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Session store options must be an object, such as { sealing }.');
  }
  assertSessionSealing(options.sealing);
  return options.sealing;
}

/** Refuses anything that is not a {@link TArtifactSealing}. */
export function assertSessionSealing(value: unknown): asserts value is TArtifactSealing {
  if (value === 'plain') return;
  const sealer =
    typeof value === 'object' && value !== null
      ? (value as { readonly sealer?: unknown }).sealer
      : undefined;
  if (
    typeof sealer === 'object' &&
    sealer !== null &&
    typeof (sealer as Partial<IArtifactSealer>).sealBytes === 'function' &&
    typeof (sealer as Partial<IArtifactSealer>).openBytes === 'function'
  ) {
    return;
  }
  throw new TypeError("A session store states how it seals: { sealer }, or 'plain'.");
}

/**
 * How a store reaches the file of each record — the one thing it gives {@link StoredSessionRecords}.
 * Each method validates the id the way the store addresses its files.
 */
export interface IStoredSessionFiles {
  /**
   * What is at session `id`'s path for a load or a listing, read whole, and what such a read reports
   * when it could not read the file whole.
   */
  load(id: string): { readonly file: TStoredSessionFile; readonly unreadable: TSessionLoadOutcome };
  /** What is at session `id`'s path now, read whole (plain files too in a store that seals), before it is replaced. */
  current(id: string): TStoredSessionFile;
  /** Replaces session `id`'s file with `stored`, whole. */
  replace(id: string, stored: Uint8Array): void;
  /** What an absent record is rebuilt as (a project session's replay log); without it, `missing`. */
  rebuild?(id: string): TSessionLoadOutcome;
}

/**
 * One store's stored form of its records: how it encodes, decodes, guards a replace, claims and
 * remembers what it holds, over the files {@link IStoredSessionFiles} reaches. A store routes every
 * read and write of a record through one of these.
 */
export class StoredSessionRecords {
  readonly #sealer: IArtifactSealer | undefined;
  readonly #files: IStoredSessionFiles;
  readonly #markers: IProcessMarkers;
  readonly #claims: SessionClaims;
  readonly #authorship: StoredSessionAuthorship | undefined;
  /** What a store that seals offers as `IInteractiveSessionStore.authorship`; absent from one that never does. */
  readonly authorship: ISessionAuthorship | undefined;

  /**
   * @param markers the writer markers of the store's `claims` directory, beside its records: every
   *   claim, lend and write of an id holds the id's marker, so a store without them does not exist.
   * @param words how refusals are worded (`ISessionStoreOptions.releaseCommand`).
   */
  constructor(
    sealing: TArtifactSealing,
    files: IStoredSessionFiles,
    markers: IProcessMarkers,
    words: ISessionClaimRefusalWords = {},
  ) {
    assertSessionSealing(sealing);
    assertProcessMarkers(markers);
    this.#sealer = sealing === 'plain' ? undefined : sealing.sealer;
    this.#files = files;
    this.#markers = markers;
    this.#claims = new SessionClaims(
      words.releaseCommand === undefined ? {} : { releaseCommand: words.releaseCommand },
      { pid: process.pid, windows: process.platform === 'win32' },
    );
    if (this.#sealer === undefined) {
      this.#authorship = undefined;
      this.authorship = undefined;
      return;
    }
    const engine = new StoredSessionAuthorship(
      this.#sealer,
      files,
      new SealedSessionMemory((id) => this.#claims.has(id)),
      this.#claims,
      (id, write) => this.#underWriteMarker(id, write),
    );
    this.#authorship = engine;
    this.authorship = Object.freeze({
      adopt: (id: string, digest: string): TSessionAdoptResult => {
        assertSafeSessionId(id);
        // The raise may tag the file in place: a write of the id, so it holds the id's marker.
        const result = this.#underWriteMarker(id, () => engine.adopt(id, digest));
        return result === 'has_writer' ? 'has_writer' : result;
      },
      heldDigest: (id: string) => {
        assertSafeSessionId(id);
        return engine.heldDigest(id);
      },
      onUnlock: (listener: () => void) => engine.onUnlock(listener),
    });
  }

  /** Whether this store writes its records sealed. */
  get seals(): boolean {
    return this.#sealer !== undefined;
  }

  /**
   * What session `id` holds, saying which of the five things happened. Only a load that asks to `hold`
   * remembers a record it read, so that this instance can go on saving the session after the keys
   * lock; a probe remembers nothing, and so can never push a held session out of the bounded memory
   * or keep plaintext it was only looking at.
   */
  load(id: string, options: ISessionLoadOptions = {}): TSessionLoadOutcome {
    return this.#read(id, options.hold === true ? 'hold' : 'probe');
  }

  /** {@link load} for one entry of a listing, which no writer merges. */
  listed(id: string): TSessionLoadOutcome {
    return this.#read(id, 'list');
  }

  /**
   * Claims session `id` for a session this process runs and reads it in the same call (see
   * `IInteractiveSessionStore.claim`): the id's writer marker is taken first — published, or taken
   * over under `lease` — and the read follows, so nothing another writer saves can come between them.
   * An in-process runner's claim of a record a handoff save left takes it over; a copy's read takes
   * no marker. Throws `SessionClaimedError`: `has_writer` for an id claimed or lent here or held by
   * another writer, naming it, and `released` for a lease that has ended.
   */
  claim(id: string, options: ISessionClaimOptions = {}): ISessionClaim {
    this.#claims.assertUnclaimed(id);
    const fresh = options.fresh === true;
    this.#authorship?.beforeClaim(id, fresh, options.lease !== undefined);
    const marker = options.copy === true ? undefined : this.#takeMarker(id, options.lease);
    return this.#claims.open(id, fresh, marker, () => {
      const { file, unreadable } = this.#files.load(id);
      return this.#authorship === undefined
        ? this.#readPlain(id, file, unreadable)
        : this.#authorship.claimRead(id, fresh, file, unreadable, () => this.#rebuild(id));
    });
  }

  /**
   * Lends session `id` to another process (see `IInteractiveSessionStore.lend`): its marker is
   * published for this process with the digest of a fresh nonce, which the borrowing process claims
   * with, and the id counts as written here until the end, which removes the marker whoever holds it.
   */
  lend(id: string): ISessionLease {
    this.#claims.assertUnclaimed(id);
    const nonce = randomBytes(32).toString('hex');
    const digest = createHash('sha256').update(nonce, 'utf8').digest('hex');
    const published = this.#markers.acquire(id, { leaseDigest: digest });
    if (published.status !== 'acquired') {
      throw this.#claims.refusal(id, 'has_writer', { holder: writerHolderOf(published.holder) });
    }
    const unlend = this.#claims.lend(id);
    let ended = false;
    return Object.freeze({
      nonce,
      end: (): void => {
        if (ended) return;
        ended = true;
        try {
          this.#markers.endLease(id, digest);
        } finally {
          unlend();
        }
      },
    });
  }

  /**
   * Whether session `id` may have a writer now: a claim or a lend of this store, or the writer marker
   * of any other holder whose owner is not provably gone. A surface that would open the id as another
   * session asks this first.
   */
  hasWriter(id: string): boolean {
    if (this.#claims.has(id) || this.#claims.isLent(id)) return true;
    const marker = this.#markers.inspect(id);
    return marker.status === 'held' && marker.holder.liveness !== 'gone';
  }

  /**
   * Saves `record` after the checks a save must pass: a claimed id is saved only under its live claim,
   * and a claim that ended or lost its marker is refused (the write fence); a save without a claim
   * takes the id's marker for the write and is refused while another writer holds it. Then the file
   * there must be replaceable — absent, plain, exactly what this instance last wrote or holds, or
   * sealed and openable here (a claimed id's only when it is what the owner wrote). What the check
   * stops is a store replacing a sealed session nobody in this process can read. A write that fails
   * with its bytes already in place is remembered as this store's own.
   */
  save(record: IInteractiveSessionRecord, options: ISessionSaveOptions = {}): void {
    const id = record.id;
    const marker = this.#claims.markerForSave(id, options.claim);
    if (marker !== undefined) {
      this.#write(record, options);
      return;
    }
    this.#withTransientMarker(id, () => this.#write(record, options));
  }

  /** Removes session `id`'s record with `remove`, holding the id's marker; refused while another writer holds it. */
  delete(id: string, remove: () => void): void {
    this.#claims.markerForSave(id, undefined);
    this.#withTransientMarker(id, () => {
      this.forget(id);
      remove();
    });
  }

  #write(record: IInteractiveSessionRecord, options: ISessionSaveOptions): void {
    const id = record.id;
    const existing = this.#files.current(id);
    const engine = this.#authorship;
    if (engine === undefined) {
      this.#assertPlainReplaceable(id, existing);
      this.#files.replace(id, encodeStoredSession(record, undefined).stored);
      return;
    }
    engine.assertReplaceable(id, existing);
    const prepared = engine.prepare(id, envelopeText(record), options);
    const handoff = options.handoff === true;
    try {
      this.#files.replace(id, prepared.stored);
    } catch (error) {
      // A step after the rename (the directory flush) can fail with the new bytes already in place;
      // they are this store's own, and the next save must know them, or one unlucky write would block
      // this session while the keys are locked. Only bytes provably at the path are remembered.
      engine.wroteIfPresent(id, prepared, this.#currentQuietly(id), handoff);
      throw error;
    }
    engine.wrote(id, prepared, handoff);
  }

  /**
   * The record this instance itself last wrote or holds, for a writer whose `load` said `locked`:
   * offered only while the file is exactly the bytes it remembers. `undefined` when it holds nothing
   * for `id` (and always in a store that seals nothing); `locked` with the reason `changed` when it
   * does and the file is no longer those bytes, so the writer can say which of the two stopped it.
   */
  loadHeld(id: string): TSessionLoadOutcome | undefined {
    return this.#authorship?.held(id, this.#files.current(id));
  }

  /**
   * The sealed record of session `id` as a token another store over the same files can take with
   * {@link importHeld} (see `StoredSessionAuthorship.exportHeld`); `undefined` from a store that seals
   * nothing, whose records anyone with the store reads from disk.
   */
  exportHeld(id: string, options: ISessionExportOptions = {}): string | undefined {
    return this.#authorship?.exportHeld(id, this.#files.current(id), options);
  }

  /**
   * Holds the record a token from {@link exportHeld} carries, pinned, so a store that cannot open the
   * file (a write-only subagent process) can go on with the session. Throws `TypeError` in a store
   * that seals nothing: it would write the record in plaintext over the sealed one.
   */
  importHeld(id: string, token: string): void {
    if (this.#authorship === undefined) {
      throw new TypeError(
        'A store that seals nothing does not take a held record: it would write it in plaintext.',
      );
    }
    this.#authorship.importHeld(id, token);
  }

  /** Forgets what this instance holds of session `id`, which was deleted. */
  forget(id: string): void {
    this.#authorship?.forget(id);
  }

  /**
   * The marker a claim of `id` holds: published for this process, or taken over from the process that
   * lent it under `lease`. Throws `has_writer` naming the holder while another writer holds it, and
   * `released` when no marker carries the lease any more.
   */
  #takeMarker(id: string, lease: string | undefined): IProcessMarkerHandle {
    if (lease === undefined) {
      const published = this.#markers.acquire(id);
      if (published.status === 'acquired') return published.handle;
      throw this.#claims.refusal(id, 'has_writer', { holder: writerHolderOf(published.holder) });
    }
    const taken = this.#markers.takeOver(id, lease);
    if (taken.status === 'acquired') return taken.handle;
    if (taken.status === 'absent') throw this.#claims.refusal(id, 'released', { lease: true });
    throw this.#claims.refusal(id, 'has_writer', { holder: writerHolderOf(taken.holder) });
  }

  /** Runs `write` holding the id's marker for the write alone, refused while another writer holds it. */
  #withTransientMarker<T>(id: string, write: () => T): T {
    const published = this.#markers.acquire(id);
    if (published.status !== 'acquired') {
      throw this.#claims.refusal(id, 'has_writer', { holder: writerHolderOf(published.holder) });
    }
    try {
      return write();
    } finally {
      published.handle.release();
    }
  }

  /**
   * Runs a write of `id` that carries no claim (an adopt, a tag at the unlock) holding the id's marker:
   * the live claim's when this store claims the id, else one taken for the write. `has_writer` when
   * another writer holds it, and nothing is written.
   */
  #underWriteMarker<T>(id: string, write: () => T): T | 'has_writer' {
    try {
      if (this.#claims.markerForWrite(id) !== undefined) return write();
    } catch (error) {
      if (isSessionClaimedError(error)) return 'has_writer';
      throw error;
    }
    const published = this.#markers.acquire(id);
    if (published.status !== 'acquired') return 'has_writer';
    try {
      return write();
    } finally {
      published.handle.release();
    }
  }

  #read(id: string, purpose: TReadPurpose): TSessionLoadOutcome {
    const { file, unreadable } = this.#files.load(id);
    return this.#authorship === undefined
      ? this.#readPlain(id, file, unreadable)
      : this.#authorship.read(id, file, unreadable, () => this.#rebuild(id), purpose);
  }

  /** A read by a store that seals nothing: what the bytes say, and a sealed file is `locked` with no keys. */
  #readPlain(
    id: string,
    file: TStoredSessionFile,
    unreadable: TSessionLoadOutcome,
  ): TSessionLoadOutcome {
    if (file.kind === 'absent') return this.#rebuild(id);
    const bytes = bytesOf(file);
    if (bytes === undefined) return unreadable;
    if (!isSealedArtifactBytes(bytes)) return decodeRecordText(id, utf8Text(bytes));
    return isCurrentSealedArtifactBytes(bytes)
      ? NO_KEYS_OUTCOME
      : { status: 'unsupported', schemaVersion: undefined };
  }

  /**
   * A store that seals nothing replaces absence, a plain file and one past its read limit; a sealed
   * file is a session no key in this process opens, and an unreadable one may be one.
   */
  #assertPlainReplaceable(id: string, existing: TStoredSessionFile): void {
    switch (existing.kind) {
      case 'absent':
      case 'plain':
      case 'oversized':
        return;
      case 'unreadable':
        throw new SealedSessionUnreadableError(id, 'unreadable');
      case 'sealed':
        throw new SealedSessionUnreadableError(
          id,
          isCurrentSealedArtifactBytes(existing.bytes) ? 'no-keys' : 'newer-format',
        );
    }
  }

  #rebuild(id: string): TSessionLoadOutcome {
    return this.#files.rebuild?.(id) ?? MISSING_OUTCOME;
  }

  /** What is at the path after a failed write, which may have left it in any state: a read that fails proves nothing was written. */
  #currentQuietly(id: string): TStoredSessionFile {
    try {
      return this.#files.current(id);
    } catch {
      // allow-fallback: an unreadable path proves nothing was written, so nothing is remembered.
      return { kind: 'unreadable' };
    }
  }
}
