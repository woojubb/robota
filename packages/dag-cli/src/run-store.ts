/** SQLite-backed local run history store for `dag runs list` (no provider required). */

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Use createRequire to avoid Vite's static analysis — node:sqlite is experimental
// and not listed in builtinModules, so a static `import` causes bundler resolution failure.
const _require = createRequire(import.meta.url);

interface IDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): IStatementSync;
}

interface IStatementSync {
  run(params: Record<string, unknown>): void;
  all(params?: Record<string, unknown>): Record<string, unknown>[];
}

function openDatabaseSync(dbPath: string): IDatabaseSync {
  const mod = _require('node:sqlite') as { DatabaseSync: new (path: string) => IDatabaseSync };
  return new mod.DatabaseSync(dbPath);
}

export interface IRunStoreRecord {
  readonly runId: string;
  readonly dagId: string;
  readonly status: string;
  readonly completedAt: number;
  readonly durationMs: number;
}

export interface IRunStoreListOptions {
  readonly dagId?: string;
  readonly status?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 50;
const DB_FILENAME = 'runs.db';

export class RunStore {
  private readonly db: IDatabaseSync;

  constructor(dbPath: string) {
    this.db = openDatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        runId TEXT PRIMARY KEY,
        dagId TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        completedAt INTEGER NOT NULL,
        durationMs INTEGER NOT NULL
      )
    `);
  }

  insert(record: IRunStoreRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs (runId, dagId, status, completedAt, durationMs)
         VALUES (:runId, :dagId, :status, :completedAt, :durationMs)`,
      )
      .run({
        ':runId': record.runId,
        ':dagId': record.dagId,
        ':status': record.status,
        ':completedAt': record.completedAt,
        ':durationMs': record.durationMs,
      });
  }

  list(opts: IRunStoreListOptions = {}): IRunStoreRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.dagId !== undefined) {
      conditions.push('dagId = :dagId');
      params[':dagId'] = opts.dagId;
    }
    if (opts.status !== undefined) {
      conditions.push('status = :status');
      params[':status'] = opts.status;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? DEFAULT_LIMIT;
    params[':limit'] = limit;

    const rows = this.db
      .prepare(
        `SELECT runId, dagId, status, completedAt, durationMs FROM runs ${where} ORDER BY completedAt DESC LIMIT :limit`,
      )
      .all(params);

    return rows.map((r) => ({
      runId: String(r['runId']),
      dagId: String(r['dagId']),
      status: String(r['status']),
      completedAt: Number(r['completedAt']),
      durationMs: Number(r['durationMs']),
    }));
  }
}

const storeCache = new Map<string, RunStore>();

export function getRunStore(projectDir: string): RunStore {
  const existing = storeCache.get(projectDir);
  if (existing !== undefined) return existing;

  const dagDir = join(projectDir, '.dag');
  mkdirSync(dagDir, { recursive: true });

  const store = new RunStore(join(dagDir, DB_FILENAME));
  storeCache.set(projectDir, store);
  return store;
}
