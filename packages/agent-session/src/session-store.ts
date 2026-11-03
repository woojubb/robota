/**
 * NodeSessionStore — persists conversation sessions as JSON files.
 *
 * The caller explicitly supplies a host-owned base directory.
 * This adapter does not interpret that directory as a trusted project root.
 * The store directory is created on first write if it does not exist.
 *
 * Sealed records or plain ones, as the caller states when it builds the store (see
 * `stored-session-record.ts`); plain files are the JSON they always were. Only a store that seals
 * offers `authorship`, and says whose each record it reads is.
 */

import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  unlinkSync,
} from 'fs';
import { resolve, sep } from 'path';

import { SEALED_ARTIFACT_MAGIC, isSealedArtifactBytes } from '@robota-sdk/agent-core';
import {
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import { assertSafeSessionId, isSafeSessionId } from './session-id.js';
import { classifyStoredSessionBytes } from './stored-session-codec.js';
import { StoredSessionRecords, sessionSealingOf } from './stored-session-record.js';

import type { TStoredSessionFile } from './stored-session-codec.js';
import type { ISessionStoreOptions } from './stored-session-record.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionAuthorship,
  ISessionClaim,
  ISessionClaimOptions,
  ISessionExportOptions,
  ISessionListEntry,
  ISessionLoadOptions,
  ISessionSaveOptions,
  ISessionStoreScan,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

function errnoCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

/** What a load reports for a record it could not read: fixed text, and the errno code when there is one. */
function unreadableMessage(error: unknown): string {
  const code = errnoCode(error);
  return typeof code === 'string' && /^E[A-Z0-9]+$/.test(code)
    ? `could not read the session file (${code})`
    : 'could not read the session file';
}

/**
 * The rest of a file whose first bytes `head` holds, read through the same descriptor, so the bytes
 * judged are the bytes of one file. Reads to the size the descriptor reported: a file that grew since
 * is then not the bytes any store remembers, which fails closed.
 */
function readRest(descriptor: number, head: Buffer): Buffer {
  const bytes = Buffer.alloc(Math.max(fstatSync(descriptor).size, head.length));
  head.copy(bytes, 0);
  let offset = head.length;
  while (offset < bytes.length) {
    const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (read === 0) break;
    offset += read;
  }
  return bytes.subarray(0, offset);
}

const MISSING: TSessionLoadOutcome = Object.freeze({ status: 'missing' });

/**
 * Most recent first, and an unreadable entry sorts last rather than being dropped.
 *
 * An entry with no record has no `updatedAt` to sort by; giving it the epoch keeps it present and
 * out of the way, which is the whole point of listing it at all.
 */
/** How many of `entries` are `locked`, by why: the keys are locked, or this store holds none. */
function countLeftOut(entries: readonly ISessionListEntry[]): Omit<ISessionStoreScan, 'entries'> {
  let locked = 0;
  let noKeys = 0;
  for (const { outcome } of entries) {
    if (outcome.status !== 'locked') continue;
    if (outcome.reason === 'no-keys') noKeys += 1;
    else locked += 1;
  }
  return noKeys === 0 ? { locked } : { locked, noKeys };
}

function compareListEntriesByRecency(left: ISessionListEntry, right: ISessionListEntry): number {
  const at = (entry: ISessionListEntry): number =>
    entry.outcome.status === 'valid' ? new Date(entry.outcome.record.updatedAt).getTime() : 0;
  return at(right) - at(left);
}

/** How a {@link NodeSessionStore} is built. */
export interface INodeSessionStoreOptions extends ISessionStoreOptions {
  /**
   * An ancestor of the store's directory the HOST also owns, tightened along with it (SEC-020).
   * Optional because this adapter does not interpret its base directory as a trusted root and must
   * not guess that a parent belongs to the product — which of them do is composition's knowledge.
   * Left out, a store root that already exists keeps whatever mode it was given: the leaf is made
   * 0700 and the directory above it is not touched.
   */
  readonly ownedRoot?: string;
}

/**
 * Persistent session store backed by individual JSON files.
 *
 * Construct with a host-owned `baseDir`; framework project composition uses a separate
 * authority-backed adapter over the same neutral port.
 */
export class NodeSessionStore implements IInteractiveSessionStore {
  private readonly baseDir: string;
  private readonly ownedRoot: string | undefined;
  /** How records are stored, and what this instance claims, wrote or holds. */
  private readonly records: StoredSessionRecords;
  /** What only a store that seals offers (`IInteractiveSessionStore.authorship`); absent from one that never does. */
  declare readonly authorship?: ISessionAuthorship;

  /**
   * @param baseDir the directory holding the records.
   * @param options `sealing` (required): `{ sealer }` seals what `save` writes and opens what `load`
   *   reads; `'plain'` writes plain JSON and reports a sealed file it finds as `locked`.
   *   `ownedRoot`: see {@link INodeSessionStoreOptions}.
   */
  constructor(baseDir: string, options: INodeSessionStoreOptions) {
    this.records = new StoredSessionRecords(sessionSealingOf(options), {
      load: (id) => this.loadFile(id),
      current: (id) => this.readExisting(this.filePath(id)),
      replace: (id, stored) => {
        this.ensureDir();
        writeOwnerOnlyFile(this.filePath(id), stored);
      },
    });
    this.baseDir = baseDir;
    this.ownedRoot = options.ownedRoot;
    // Only on a store that seals: a store whose records carry no authorship has nothing to adopt.
    const authorship = this.records.authorship;
    if (authorship !== undefined) this.authorship = authorship;
  }

  /**
   * Claims `id` for a session this process runs, reading it in the same call
   * (`IInteractiveSessionStore.claim`): exclusive in this store, and every later save of the id must
   * carry the claim until it is released.
   */
  claim(id: string, options?: ISessionClaimOptions): ISessionClaim {
    this.filePath(id);
    return this.records.claim(id, options);
  }

  /** Whether something this process runs may still write session `id` (`IInteractiveSessionStore.hasWriter`). */
  hasWriter(id: string): boolean {
    return this.records.hasWriter(id);
  }

  /**
   * Ensure the storage directory exists AND that only its owner can enter it (SEC-020).
   *
   * The `existsSync` guard this replaces is the whole defect. It skipped the case that matters: a
   * directory some earlier version, a shared CI checkout, or another local user left at a wider
   * mode was adopted as ours with no signal. Measured under umask 022 before this change, a fresh
   * sessions directory came out 0755 and its records 0644 — and a directory pre-created at 0777
   * stayed 0777.
   */
  private ensureDir(): void {
    ensureOwnerOnlyDirectory(
      this.baseDir,
      this.ownedRoot === undefined ? {} : { withinRoot: this.ownedRoot },
    );
  }

  /**
   * Absolute path to a session's JSON file.
   *
   * SEC-006: every public method routes through here, so validating the id at this one point covers
   * `save` (write), `load` (read), and `delete` (unlink) at once.
   *
   * Issue #2240: `assertSafeSessionId` is the guard, and it is sound — no separator, no `.`/`..`
   * can pass it. But it is a regex reject behind a helper, which static analysis does not model as
   * a path sanitizer, so `js/path-injection` re-opened on `load` every time this function changed
   * length. The containment check below is the shape such tools DO recognise: the resolved path
   * must stay inside the resolved base directory. It is unreachable after the assertion and costs
   * one `resolve`; it exists so the guard is visible where the sink is, not to replace the guard.
   */
  private filePath(id: string): string {
    assertSafeSessionId(id);
    const base = resolve(this.baseDir);
    const candidate = resolve(base, `${id}.json`);
    if (!candidate.startsWith(base + sep)) {
      throw new Error(
        `Invalid session id: ${JSON.stringify(id)} resolves outside the session store.`,
      );
    }
    return candidate;
  }

  /**
   * Persist a session record to disk atomically (CORE-019).
   * Creates the storage directory if needed.
   *
   * Bytes go to a same-directory temp file first, then move into place with rename —
   * a crash mid-write can therefore never leave a truncated JSON where the previous
   * record used to be. Same-directory is load-bearing: cross-device rename is a copy.
   *
   * SEC-020: the atomic write now comes from `writeOwnerOnlyFile`, which carries the mode from the
   * moment the temp file is created. The hand-rolled version here wrote it at the umask's default
   * and let `rename` carry that mode to the final path, so every record was 0644 — and even setting
   * the mode after the write would leave a window in which the full transcript was world-readable
   * on disk.
   */
  save(session: IInteractiveSessionRecord, options: ISessionSaveOptions = {}): void {
    this.ensureDir();
    this.filePath(session.id);
    // A sealed file this store cannot open is a session nobody here has read; replacing it would
    // destroy the only copy — unless it is provably exactly what this instance last wrote or holds,
    // which is how a locked process goes on saving the sessions it is running. A file it could not
    // read at all may be one of those, so it is protected the same way. A plain or absent file is
    // replaced.
    // TRANS-007: the versioned envelope, not the bare record. Without a version on disk there is
    // nothing to compare, so "written by a build this one does not read" cannot be told from
    // "damaged" even in principle — and those two need different things from the user.
    // SEC-020's owner-only atomic write carries it: the envelope is WHAT is written, the mode is HOW.
    // A store that seals writes the same envelope sealed to this session's id, tagged when it can
    // vouch that the content is the owner's and the keys are unlocked.
    this.records.save(session, options);
  }

  /**
   * What is at `path` now, for the guard before a save. Only "no such file" means there is nothing
   * to protect; a file that cannot be opened or read is `unreadable`. The first bytes tell plain from
   * sealed, so the common plain case costs one small read in a store that seals nothing, and the rest
   * of the file is read through the same descriptor, so the bytes judged are those of one file: a
   * sealed file's always, a plain one's in a store that seals, which must tell whether it is exactly
   * what the store holds.
   */
  private readExisting(path: string): TStoredSessionFile {
    let descriptor: number;
    try {
      descriptor = openSync(path, 'r');
    } catch (error) {
      return errnoCode(error) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
    }
    try {
      const head = Buffer.alloc(SEALED_ARTIFACT_MAGIC.length);
      const length = readSync(descriptor, head, 0, head.length, 0);
      if (!isSealedArtifactBytes(head.subarray(0, length))) {
        return this.records.seals
          ? { kind: 'plain', bytes: readRest(descriptor, head.subarray(0, length)) }
          : { kind: 'plain' };
      }
      return { kind: 'sealed', bytes: readRest(descriptor, head) };
    } catch {
      return { kind: 'unreadable' };
    } finally {
      closeSync(descriptor);
    }
  }

  /**
   * Load a session by its ID, saying WHICH of the five things happened.
   *
   * `undefined` used to answer the first four — never saved, damaged, written by a build this one
   * cannot read, and the read failed — and a caller that meant to preserve fields it does not own
   * then treated "damaged" as "no prior record" and overwrote the file. The outcome type is what
   * removes that, by making the caller answer the question it was not asking. The fifth, `locked`,
   * is a sealed file this process cannot open right now: present and intact, so neither of the two.
   *
   * Only a load that asks to `hold` the session remembers a sealed record it opens (see
   * {@link StoredSessionRecords.load}); a probe and the listing remember nothing.
   */
  load(id: string, options: ISessionLoadOptions = {}): TSessionLoadOutcome {
    this.filePath(id);
    return this.records.load(id, options);
  }

  /** What is at session `id`'s path, read whole, for one load or listing of it. */
  private loadFile(id: string): {
    readonly file: TStoredSessionFile;
    readonly unreadable: TSessionLoadOutcome;
  } {
    const path = this.filePath(id);
    let raw: Buffer;
    try {
      raw = readFileSync(path);
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') return { file: { kind: 'absent' }, unreadable: MISSING };
      // Only "no such file" is missing. A file that cannot be read — or a path that cannot even be
      // looked at — may be a session that is still there; reporting it as missing is what let a
      // recovery path run over one. Fixed text and the errno code: the error's own message names the
      // path and says nothing the code does not.
      return {
        file: { kind: 'unreadable' },
        unreadable: {
          status: 'corrupt',
          issues: [{ path: '', message: unreadableMessage(error) }],
        },
      };
    }
    // SEC-020 / #3679: `save` tightens a record it REWRITES, but a session that is only resumed or
    // listed keeps whatever mode its writer left — so a record from a pre-SEC-020 build stays 0644.
    // Repair it on read: `list` routes through here, so browsing or resuming a legacy session makes
    // it owner-only. A no-op once the mode is already tight, and on non-POSIX hosts.
    //
    // Best-effort on this READ path, unlike the write callers of `tightenExistingFile`: a record
    // owned by another account (EPERM) or on a chmod-ignoring mount makes it throw, and this is the
    // one place `tightenExistingFile` runs from `list` — where a single unrepairable file must not
    // take the whole listing down (the invariant `outcomeForListedId` upholds). A failed repair
    // leaves the mode as it was and the record is still returned.
    try {
      tightenExistingFile(path);
    } catch {
      // allow-fallback: repairing the mode is opportunistic; reading the session is the job.
    }
    return { file: classifyStoredSessionBytes(raw), unreadable: MISSING };
  }

  /**
   * The record this instance itself last wrote or holds, offered only while the file on disk is
   * still exactly those bytes. It is what a writer needs when `load` says `locked` for a session it
   * is running: the keys that read it back are locked, the copy it holds is not. `undefined` for
   * a session this instance never held, or whose file has changed since.
   */
  loadHeld(id: string): TSessionLoadOutcome | undefined {
    this.filePath(id);
    return this.records.loadHeld(id);
  }

  /** The sealed record of `id` as a token for another store over these files (see {@link StoredSessionRecords.exportHeld}). */
  exportHeld(id: string, options?: ISessionExportOptions): string | undefined {
    this.filePath(id);
    return this.records.exportHeld(id, options);
  }

  /** Holds the record a token from another store's `exportHeld` carries (see {@link StoredSessionRecords.importHeld}). */
  importHeld(id: string, token: string): void {
    this.filePath(id);
    this.records.importHeld(id, token);
  }

  /**
   * Every session this directory holds, each with what the store concluded about it.
   *
   * Unreadable entries are REPORTED rather than skipped. A store that distinguishes four outcomes on
   * `load` and then hides two of them from the surface a person browses has moved the defect rather
   * than removed it: the difference a user experiences is between "my session vanished" and "my
   * session needs a different build".
   *
   * The one exception is a sealed session this process cannot open: there is no record to describe
   * (no title, no time, no workspace), so it is not an entry, and {@link scan} is how a surface
   * still says that some sessions are there.
   */
  list(): readonly ISessionListEntry[] {
    return this.scan().entries;
  }

  /**
   * The listing and how many sealed sessions it left out because they cannot be opened right now,
   * from one read of each file, counted by why: locked keys, or no keys here at all. A record that
   * cannot be read has nothing to show, so the counts are what keep those sessions from looking gone.
   */
  scan(): ISessionStoreScan {
    const all = this.readAll();
    return {
      entries: all
        .filter((entry) => entry.outcome.status !== 'locked')
        .sort(compareListEntriesByRecency),
      ...countLeftOut(all),
    };
  }

  private readAll(): ISessionListEntry[] {
    if (!existsSync(this.baseDir)) {
      return [];
    }
    return readdirSync(this.baseDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .map((id) => ({ id, outcome: this.outcomeForListedId(id) }));
  }

  /**
   * The outcome for one directory entry, without letting a bad NAME throw out of `list`.
   *
   * `load` validates the id, because an id reaching it is a caller's value and a malformed one is a
   * bug or an attack (SEC-006). A name read out of the directory is neither: the store did not
   * choose it, and one file it cannot use as an id must not take the whole listing down with it.
   * Routing `list` through `load` made exactly that happen — a single `my session.json` in the
   * sessions directory threw, and the resume picker went with it.
   *
   * Reporting it is the same answer `list` gives for every other file it cannot read, which is the
   * property this work exists to establish.
   */
  private outcomeForListedId(id: string): TSessionLoadOutcome {
    if (!isSafeSessionId(id)) {
      return {
        status: 'corrupt',
        issues: [{ path: '', message: 'the file name is not a usable session id' }],
      };
    }
    return this.records.listed(id);
  }

  /**
   * Delete a session by its ID.
   * No-ops silently if the session does not exist.
   */
  delete(id: string): void {
    const path = this.filePath(id);
    this.records.forget(id);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}
