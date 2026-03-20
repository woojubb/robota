/**
 * Session Logger — pluggable logging interface for session events.
 *
 * ISessionLogger defines the contract. FileSessionLogger is the default
 * implementation that writes JSONL to disk. Consumers can implement their
 * own (e.g., remote, database, silent) and inject via Session constructor.
 */

import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Session log event data — extensible record of event metadata. */
export type TSessionLogData = Record<string, string | number | boolean | object>;

/**
 * Session logger interface — injected into Session for pluggable logging.
 *
 * Implementations decide where and how to persist session events.
 * The Session class calls log() for every significant action.
 */
export interface ISessionLogger {
  /** Log a session event with structured data. */
  log(sessionId: string, event: string, data: TSessionLogData): void;
}

/**
 * File-based session logger — writes JSONL to {logDir}/{sessionId}.jsonl.
 *
 * This is the default implementation used by the CLI.
 * Each line is a self-contained JSON object with timestamp, sessionId, event, and data.
 */
export class FileSessionLogger implements ISessionLogger {
  private readonly logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      // Best-effort: logging disabled if directory cannot be created
    }
  }

  log(sessionId: string, event: string, data: TSessionLogData): void {
    try {
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId,
        event,
        ...data,
      });
      const logFile = join(this.logDir, `${sessionId}.jsonl`);
      appendFileSync(logFile, entry + '\n');
    } catch {
      // Logging failure must never break the session
    }
  }
}

/** No-op logger — used when logging is disabled. */
export class SilentSessionLogger implements ISessionLogger {
  log(): void {
    // intentionally empty
  }
}
