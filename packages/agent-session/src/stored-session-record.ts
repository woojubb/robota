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
 * ids its sessions run (`session-claims.ts`), exclusively and fencing their saves; a store that seals
 * also decides and keeps whose each record is (`stored-session-authorship.ts`).
 */

import { isCurrentSealedArtifactBytes, isSealedArtifactBytes } from '@robota-sdk/agent-core';

import { SealedSessionUnreadableError } from './sealed-session-refusal.js';
import { SealedSessionMemory } from './sealed-session-memory.js';
import { SessionClaims } from './session-claims.js';
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

import type { TReadPurpose } from './stored-session-authorship.js';
import type { TStoredSessionFile } from './stored-session-codec.js';
import type { IArtifactSealer, TArtifactSealing } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  ISessionAuthorship,
  ISessionClaim,
  ISessionClaimOptions,
  ISessionExportOptions,
  ISessionLoadOptions,
  ISessionSaveOptions,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/**
 * How a session store is built. `sealing` is required: every store states whether it keeps its
 * records sealed or plain, because a store that silently kept them plain beside sealed ones would
 * write plaintext next to them. A host that seals states it for every store it builds.
 */
export interface ISessionStoreOptions {
  readonly sealing: TArtifactSealing;
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
  readonly #claims = new SessionClaims();
  readonly #authorship: StoredSessionAuthorship | undefined;
  /** What a store that seals offers as `IInteractiveSessionStore.authorship`; absent from one that never does. */
  readonly authorship: ISessionAuthorship | undefined;

  constructor(sealing: TArtifactSealing, files: IStoredSessionFiles) {
    assertSessionSealing(sealing);
    this.#sealer = sealing === 'plain' ? undefined : sealing.sealer;
    this.#files = files;
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
    );
    this.#authorship = engine;
    this.authorship = Object.freeze({
      adopt: (id: string, digest: string) => {
        assertSafeSessionId(id);
        return engine.adopt(id, digest);
      },
      heldDigest: (id: string) => {
        assertSafeSessionId(id);
        return engine.heldDigest(id);
      },
      exportEnded: (id: string) => {
        assertSafeSessionId(id);
        engine.exportEnded(id);
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
   * `IInteractiveSessionStore.claim`). An in-process runner's claim of a record a handoff save left
   * takes it over. Throws `SessionClaimedError` for an id already claimed here, one a write-only
   * child holds as handed to it, or one exported to a process that may still save it.
   */
  claim(id: string, options: ISessionClaimOptions = {}): ISessionClaim {
    this.#claims.assertUnclaimed(id);
    const fresh = options.fresh === true;
    this.#authorship?.beforeClaim(id, fresh);
    return this.#claims.open(id, fresh, () => {
      const { file, unreadable } = this.#files.load(id);
      return this.#authorship === undefined
        ? this.#readPlain(id, file, unreadable)
        : this.#authorship.claimRead(id, fresh, file, unreadable, () => this.#rebuild(id));
    });
  }

  /**
   * Whether something this process runs may still write session `id`: a live claim, or in a store
   * that seals an export to a process that has not ended (or, in the write-only child, the record it
   * was handed). A surface that would open the id as another session asks this first.
   */
  hasWriter(id: string): boolean {
    return this.#claims.has(id) || this.#authorship?.hasUnclaimedWriter(id) === true;
  }

  /**
   * Saves `record` after the checks a save must pass: a claimed id is saved only under its live claim,
   * and a claim that ended is refused (the write fence); then the file there must be replaceable —
   * absent, plain, exactly what this instance last wrote or holds, or sealed and openable here (a
   * claimed id's only when it is what the owner wrote). The check and the write are two steps, so two
   * writers saving one session at the same moment can still replace each other, as plain records
   * always could; what the check stops is a store replacing a sealed session nobody in this process
   * can read. A write that fails with its bytes already in place is remembered as this store's own.
   */
  save(record: IInteractiveSessionRecord, options: ISessionSaveOptions = {}): void {
    const id = record.id;
    this.#claims.assertSaveAllowed(id, options.claim);
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
