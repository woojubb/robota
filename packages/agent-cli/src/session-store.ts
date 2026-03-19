/**
 * SessionStore — persists conversation sessions as JSON files.
 *
 * Sessions are stored at `~/.robota/sessions/{id}.json`.
 * The store directory is created on first write if it does not exist.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

/** A persisted session record */
export interface ISessionRecord {
  /** Unique session identifier */
  id: string;
  /** Optional human-readable session name */
  name?: string;
  /** Working directory when the session was created */
  cwd: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
  /** Conversation messages (opaque to the store) */
  messages: unknown[];
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
export class SessionStore {
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

  /**
   * Persist a session record to disk.
   * Creates the storage directory if needed.
   */
  save(session: ISessionRecord): void {
    this.ensureDir();
    writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Load a session by its ID.
   * Returns `undefined` when the session file does not exist.
   */
  load(id: string): ISessionRecord | undefined {
    const path = this.filePath(id);
    if (!existsSync(path)) {
      return undefined;
    }
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as ISessionRecord;
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
