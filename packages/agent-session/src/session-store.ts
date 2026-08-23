/**
 * NodeSessionStore — persists conversation sessions as JSON files.
 *
 * The caller explicitly supplies a host-owned base directory.
 * This adapter does not interpret that directory as a trusted project root.
 * The store directory is created on first write if it does not exist.
 */

import { readFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

import { ensureOwnerOnlyDirectory, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';

import { assertSafeSessionId } from './session-id.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

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
   */
  private filePath(id: string): string {
    assertSafeSessionId(id);
    return join(this.baseDir, `${id}.json`);
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
    writeOwnerOnlyFile(this.filePath(session.id), JSON.stringify(session, null, 2));
  }

  /**
   * Load a session by its ID.
   * Returns `undefined` when the session file does not exist or is corrupt.
   */
  load(id: string): IInteractiveSessionRecord | undefined {
    const path = this.filePath(id);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as IInteractiveSessionRecord;
    } catch {
      // allow-fallback: corrupt session file is unrecoverable; treat as missing to avoid crash on --continue/--resume
      return undefined;
    }
  }

  /**
   * List all persisted sessions, sorted by `updatedAt` descending (most recent first).
   */
  list(): IInteractiveSessionRecord[] {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const files = readdirSync(this.baseDir).filter((f) => f.endsWith('.json'));
    const sessions: IInteractiveSessionRecord[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.baseDir, file), 'utf-8');
        const record = JSON.parse(raw) as IInteractiveSessionRecord;
        sessions.push(record);
      } catch {
        // Skip malformed files
      }
    }

    return sessions.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
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
