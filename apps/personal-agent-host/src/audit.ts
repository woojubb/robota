import { appendFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ensurePrivateDir, isNotFound, PRIVATE_FILE_MODE } from './fs-util.js';

export type AuditResult = 'ok' | 'refused' | 'failed' | 'recovered';

export interface IAuditEntry {
  ts: string;
  actor: string;
  command: string;
  account: string | null;
  result: AuditResult;
  reason: string | null;
}

/** Append-only JSON lines, owner-only. Callers pass reasons that are already free of secrets. */
export class AuditLog {
  private constructor(private readonly path: string) {}

  static async open(path: string): Promise<AuditLog> {
    await ensurePrivateDir(dirname(path));
    try {
      await chmod(path, PRIVATE_FILE_MODE);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return new AuditLog(path);
  }

  async append(entry: Omit<IAuditEntry, 'ts'> & { ts?: string }): Promise<void> {
    const { ts, ...rest } = entry;
    const line: IAuditEntry = { ts: ts ?? new Date().toISOString(), ...rest };
    await appendFile(this.path, `${JSON.stringify(line)}\n`, { mode: PRIVATE_FILE_MODE });
  }
}
