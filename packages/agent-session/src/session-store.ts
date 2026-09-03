/**
 * NodeSessionStore — persists conversation sessions as JSON files.
 *
 * The caller explicitly supplies a host-owned base directory.
 * This adapter does not interpret that directory as a trusted project root.
 * The store directory is created on first write if it does not exist.
 */

import { readFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { resolve, sep } from 'path';

import { ensureOwnerOnlyDirectory, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';

import { assertSafeSessionId, isSafeSessionId } from './session-id.js';
import {
  SESSION_RECORD_ENVELOPE_VERSION,
  decodeVersionedInteractiveSessionRecord,
} from './session-record-codec/index.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/** A read failure described without leaking the whole error object into a persisted diagnostic. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Decode stored bytes into an outcome, keeping "not JSON" and "not a record" the same answer. */
function decodeStoredSession(raw: string): TSessionLoadOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      status: 'corrupt',
      issues: [{ path: '', message: 'the session file is not JSON' }],
    };
  }
  const outcome = decodeVersionedInteractiveSessionRecord(parsed);
  if (outcome.status === 'valid') return { status: 'valid', record: outcome.record };
  if (outcome.status === 'unsupported') {
    return { status: 'unsupported', schemaVersion: outcome.schemaVersion };
  }
  return { status: 'corrupt', issues: outcome.issues };
}

/**
 * Most recent first, and an unreadable entry sorts last rather than being dropped.
 *
 * An entry with no record has no `updatedAt` to sort by; giving it the epoch keeps it present and
 * out of the way, which is the whole point of listing it at all.
 */
function compareListEntriesByRecency(left: ISessionListEntry, right: ISessionListEntry): number {
  const at = (entry: ISessionListEntry): number =>
    entry.outcome.status === 'valid' ? new Date(entry.outcome.record.updatedAt).getTime() : 0;
  return at(right) - at(left);
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

  /**
   * @param baseDir the directory holding the records.
   * @param ownedRoot an ancestor of `baseDir` the HOST also owns, tightened along with it (SEC-020).
   *   Optional because this adapter does not interpret its base directory as a trusted root and must
   *   not guess that a parent belongs to the product — which of them do is composition's knowledge.
   *   Omitting it leaves a store root an older version created at whatever mode it was given, which
   *   is what review of PR #2224 found: the leaf was 0700 and the directory above it was not.
   */
  constructor(baseDir: string, ownedRoot?: string) {
    this.baseDir = baseDir;
    this.ownedRoot = ownedRoot;
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
  save(session: IInteractiveSessionRecord): void {
    this.ensureDir();
    // TRANS-007: the versioned envelope, not the bare record. Without a version on disk there is
    // nothing to compare, so "written by a build this one does not read" cannot be told from
    // "damaged" even in principle — and those two need different things from the user.
    // SEC-020's owner-only atomic write carries it: the envelope is WHAT is written, the mode is HOW.
    writeOwnerOnlyFile(
      this.filePath(session.id),
      JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: session }, null, 2),
    );
  }

  /**
   * Load a session by its ID, saying WHICH of the four things happened.
   *
   * `undefined` used to answer all four — never saved, damaged, written by a build this one cannot
   * read, and the read failed — and a caller that meant to preserve fields it does not own then
   * treated "damaged" as "no prior record" and overwrote the file. The outcome type is what removes
   * that, by making the caller answer the question it was not asking.
   */
  load(id: string): TSessionLoadOutcome {
    const path = this.filePath(id);
    if (!existsSync(path)) {
      return { status: 'missing' };
    }
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (error) {
      // A file that exists and cannot be read is NOT missing. Reporting it as missing is what let a
      // recovery path run over a session that was still there.
      return {
        status: 'corrupt',
        issues: [{ path: '', message: `could not read the session file: ${describeError(error)}` }],
      };
    }
    return decodeStoredSession(raw);
  }

  /**
   * Every session this directory holds, each with what the store concluded about it.
   *
   * Unreadable entries are REPORTED rather than skipped. A store that distinguishes four outcomes on
   * `load` and then hides two of them from the surface a person browses has moved the defect rather
   * than removed it: the difference a user experiences is between "my session vanished" and "my
   * session needs a different build".
   */
  list(): readonly ISessionListEntry[] {
    if (!existsSync(this.baseDir)) {
      return [];
    }
    return readdirSync(this.baseDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .map((id) => ({ id, outcome: this.outcomeForListedId(id) }))
      .sort(compareListEntriesByRecency);
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
    return this.load(id);
  }

  /**
   * Delete a session by its ID.
   * No-ops silently if the session does not exist.
   */
  delete(id: string): void {
    const path = this.filePath(id);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}
