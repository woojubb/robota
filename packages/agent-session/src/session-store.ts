/**
 * NodeSessionStore — persists conversation sessions as JSON files.
 *
 * The caller explicitly supplies a host-owned base directory.
 * This adapter does not interpret that directory as a trusted project root.
 * The store directory is created on first write if it does not exist.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  renameSync,
} from 'fs';
import { join } from 'path';

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

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** Ensure the storage directory exists */
  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
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
   */
  save(session: IInteractiveSessionRecord): void {
    this.ensureDir();
    const finalPath = this.filePath(session.id);
    const tempPath = `${finalPath}.${process.pid}.tmp`;
    const serialized = JSON.stringify(session, null, 2);
    writeFileSync(tempPath, serialized, 'utf-8');
    try {
      renameSync(tempPath, finalPath);
    } catch (error) {
      unlinkSync(tempPath);
      throw error;
    }
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
