/**
 * SessionStore — persists conversation sessions as JSON files.
 *
 * Sessions are stored at `~/.robota/sessions/{id}.json` by default.
 * Consumers can inject a project-local directory such as `.robota/sessions`.
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

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';

/**
 * A persisted session record.
 *
 * TYPE-003: alias of the typed resumable-session contract (`IInteractiveSessionRecord`,
 * `@robota-sdk/agent-interface-transport` — DATA-001 SSOT). This used to be a relaxed
 * `unknown[]`-payload mirror of that contract, which drifted (it silently lacked the later
 * `plan`/`activeBranch` fields) and forced an `as unknown as` bridge in `agent-framework`'s
 * store facade. The store itself stays payload-agnostic: it never inspects the fields it
 * persists, and `load`/`list` keep the honest `JSON.parse(...) as ISessionRecord` trust
 * boundary (no runtime validation is added or removed by the alias).
 */
export type ISessionRecord = IInteractiveSessionRecord;

/** Minimal persistence port consumed by Session. */
export interface ISessionStore {
  save(session: ISessionRecord): void;
  load(id: string): ISessionRecord | undefined;
  list(): ISessionRecord[];
  delete(id: string): void;
  /** Return the absolute file path for a session file, if the store is file-backed. */
  getFilePath?(id: string): string;
}

/**
 * Return the current user home directory.
 * Reads process.env.HOME at call time so tests can override it.
 */
function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

/**
 * Persistent session store backed by individual JSON files.
 *
 * Construct with a custom `baseDir` to redirect storage (useful in tests).
 */
export class SessionStore implements ISessionStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(getHomeDir(), '.robota', 'sessions');
  }

  /** Ensure the storage directory exists */
  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /** Absolute path to a session's JSON file */
  private filePath(id: string): string {
    return join(this.baseDir, `${id}.json`);
  }

  /** Return the absolute file path for a session — implements ISessionStore.getFilePath */
  getFilePath(id: string): string {
    return this.filePath(id);
  }

  /**
   * Persist a session record to disk atomically (CORE-019).
   * Creates the storage directory if needed.
   *
   * Bytes go to a same-directory temp file first, then move into place with rename —
   * a crash mid-write can therefore never leave a truncated JSON where the previous
   * record used to be. Same-directory is load-bearing: cross-device rename is a copy.
   */
  save(session: ISessionRecord): void {
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
  load(id: string): ISessionRecord | undefined {
    const path = this.filePath(id);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as ISessionRecord;
    } catch {
      // allow-fallback: corrupt session file is unrecoverable; treat as missing to avoid crash on --continue/--resume
      return undefined;
    }
  }

  /**
   * List all persisted sessions, sorted by `updatedAt` descending (most recent first).
   */
  list(): ISessionRecord[] {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const files = readdirSync(this.baseDir).filter((f) => f.endsWith('.json'));
    const sessions: ISessionRecord[] = [];

    for (const file of files) {
      try {
        const raw = readFileSync(join(this.baseDir, file), 'utf-8');
        const record = JSON.parse(raw) as ISessionRecord;
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
