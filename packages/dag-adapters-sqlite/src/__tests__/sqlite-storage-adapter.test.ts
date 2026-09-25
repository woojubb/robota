import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../sqlite-storage-adapter.js';
import type { IDagDefinition, IDagRun, ITaskRun } from '@robota-sdk/dag-core';

function makeDefinition(overrides: Partial<IDagDefinition> = {}): IDagDefinition {
  return {
    dagId: 'dag-1',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function makeDagRun(overrides: Partial<IDagRun> = {}): IDagRun {
  return {
    dagRunId: 'run-1',
    dagId: 'dag-1',
    version: 1,
    status: 'created',
    runKey: 'key-1',
    logicalDate: '2026-01-01T00:00:00.000Z',
    trigger: 'manual',
    ...overrides,
  };
}

function makeTaskRun(overrides: Partial<ITaskRun> = {}): ITaskRun {
  return {
    taskRunId: 'task-1',
    dagRunId: 'run-1',
    nodeId: 'node-1',
    status: 'created',
    attempt: 0,
    ...overrides,
  };
}

describe('SqliteStorageAdapter', () => {
  let adapter: SqliteStorageAdapter;

  beforeEach(() => {
    adapter = new SqliteStorageAdapter(':memory:');
  });

  afterEach(() => {
    adapter.close();
  });

  describe('definitions', () => {
    it('saves and retrieves a definition', async () => {
      const def = makeDefinition();
      await adapter.saveDefinition(def);
      const retrieved = await adapter.getDefinition('dag-1', 1);
      expect(retrieved?.dagId).toBe('dag-1');
      expect(retrieved?.version).toBe(1);
    });

    it('returns undefined for missing definition', async () => {
      const result = await adapter.getDefinition('nonexistent', 1);
      expect(result).toBeUndefined();
    });

    it('upserts on duplicate dagId+version', async () => {
      const def = makeDefinition({ status: 'draft' });
      await adapter.saveDefinition(def);
      await adapter.saveDefinition({ ...def, status: 'published' });
      const retrieved = await adapter.getDefinition('dag-1', 1);
      expect(retrieved?.status).toBe('published');
    });

    it('listDefinitions returns all sorted', async () => {
      await adapter.saveDefinition(makeDefinition({ dagId: 'b', version: 1 }));
      await adapter.saveDefinition(makeDefinition({ dagId: 'a', version: 2 }));
      await adapter.saveDefinition(makeDefinition({ dagId: 'a', version: 1 }));
      const list = await adapter.listDefinitions();
      expect(list).toHaveLength(3);
      expect(list[0].dagId).toBe('a');
      expect(list[0].version).toBe(1);
    });

    it('getLatestPublishedDefinition returns highest published version', async () => {
      await adapter.saveDefinition(makeDefinition({ version: 1, status: 'published' }));
      await adapter.saveDefinition(makeDefinition({ version: 2, status: 'published' }));
      await adapter.saveDefinition(makeDefinition({ version: 3, status: 'draft' }));
      const latest = await adapter.getLatestPublishedDefinition('dag-1');
      expect(latest?.version).toBe(2);
    });

    it('deleteDefinition removes the entry', async () => {
      await adapter.saveDefinition(makeDefinition());
      await adapter.deleteDefinition('dag-1', 1);
      expect(await adapter.getDefinition('dag-1', 1)).toBeUndefined();
    });
  });

  describe('dag runs', () => {
    it('creates and retrieves a dag run', async () => {
      const run = makeDagRun();
      await adapter.createDagRun(run);
      const retrieved = await adapter.getDagRun('run-1');
      expect(retrieved?.dagRunId).toBe('run-1');
      expect(retrieved?.status).toBe('created');
    });

    it('round-trips complete child lineage while keeping root rows absent', async () => {
      const lineage = {
        rootRunId: 'root', parentRunId: 'parent', depth: 2, maxDepth: 2,
        ancestorCompositeNodeTypes: ['first', 'second'],
      };
      await adapter.createDagRun(makeDagRun({ lineage }));
      await adapter.createDagRun(makeDagRun({ dagRunId: 'root', runKey: 'root-key' }));
      expect((await adapter.getDagRun('run-1'))?.lineage).toEqual(lineage);
      expect((await adapter.getDagRun('root'))?.lineage).toBeUndefined();
    });

    it('getDagRunByRunKey finds by run key', async () => {
      await adapter.createDagRun(makeDagRun({ runKey: 'unique-key' }));
      const result = await adapter.getDagRunByRunKey('unique-key');
      expect(result?.dagRunId).toBe('run-1');
    });

    it('updateDagRunStatus changes status and endedAt', async () => {
      await adapter.createDagRun(makeDagRun());
      await adapter.updateDagRunStatus('run-1', 'success', '2026-01-01T00:01:00.000Z');
      const updated = await adapter.getDagRun('run-1');
      expect(updated?.status).toBe('success');
      expect(updated?.endedAt).toBe('2026-01-01T00:01:00.000Z');
    });

    it('deleteDagRun removes the entry', async () => {
      await adapter.createDagRun(makeDagRun());
      await adapter.deleteDagRun('run-1');
      expect(await adapter.getDagRun('run-1')).toBeUndefined();
    });
  });

  describe('task runs', () => {
    beforeEach(async () => {
      await adapter.createDagRun(makeDagRun());
    });

    it('creates and retrieves a task run', async () => {
      await adapter.createTaskRun(makeTaskRun());
      const retrieved = await adapter.getTaskRun('task-1');
      expect(retrieved?.taskRunId).toBe('task-1');
      expect(retrieved?.status).toBe('created');
    });

    it('listTaskRunsByDagRunId returns matching runs', async () => {
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-1' }));
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-2' }));
      const list = await adapter.listTaskRunsByDagRunId('run-1');
      expect(list).toHaveLength(2);
    });

    it('updateTaskRunStatus sets status and error', async () => {
      await adapter.createTaskRun(makeTaskRun());
      await adapter.updateTaskRunStatus('task-1', 'failed', {
        code: 'SOME_ERROR',
        message: 'it failed',
        category: 'task_execution',
        retryable: false,
      });
      const updated = await adapter.getTaskRun('task-1');
      expect(updated?.status).toBe('failed');
      expect(updated?.errorCode).toBe('SOME_ERROR');
    });

    it('saveTaskRunSnapshots updates snapshot fields', async () => {
      await adapter.createTaskRun(makeTaskRun());
      await adapter.saveTaskRunSnapshots('task-1', '{"in":1}', '{"out":2}', 0.001, 0.002);
      const updated = await adapter.getTaskRun('task-1');
      expect(updated?.inputSnapshot).toBe('{"in":1}');
      expect(updated?.outputSnapshot).toBe('{"out":2}');
      expect(updated?.estimatedCredits).toBeCloseTo(0.001);
    });

    it('incrementTaskAttempt increments attempt counter', async () => {
      await adapter.createTaskRun(makeTaskRun({ attempt: 0 }));
      await adapter.incrementTaskAttempt('task-1');
      await adapter.incrementTaskAttempt('task-1');
      const updated = await adapter.getTaskRun('task-1');
      expect(updated?.attempt).toBe(2);
    });

    it('deleteTaskRunsByDagRunId removes all matching', async () => {
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-1' }));
      await adapter.createTaskRun(makeTaskRun({ taskRunId: 'task-2' }));
      await adapter.deleteTaskRunsByDagRunId('run-1');
      expect(await adapter.listTaskRunsByDagRunId('run-1')).toHaveLength(0);
    });
  });
});

/** Schema exactly as migrations 1 and 2 leave it — before `lineage_json` existed. */
const SCHEMA_V1_SQL = `
  CREATE TABLE IF NOT EXISTS dag_definitions (
    dag_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (dag_id, version)
  );

  CREATE TABLE IF NOT EXISTS dag_runs (
    dag_run_id TEXT PRIMARY KEY,
    dag_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    run_key TEXT NOT NULL,
    logical_date TEXT NOT NULL,
    trigger TEXT NOT NULL,
    definition_snapshot TEXT,
    input_snapshot TEXT,
    started_at TEXT,
    ended_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_dag_runs_run_key ON dag_runs(run_key);
  CREATE INDEX IF NOT EXISTS idx_dag_runs_dag_id ON dag_runs(dag_id);

  CREATE TABLE IF NOT EXISTS task_runs (
    task_run_id TEXT PRIMARY KEY,
    dag_run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_until TEXT,
    input_snapshot TEXT,
    output_snapshot TEXT,
    estimated_credits REAL,
    total_credits REAL,
    error_code TEXT,
    error_message TEXT,
    FOREIGN KEY (dag_run_id) REFERENCES dag_runs(dag_run_id)
  );

  CREATE INDEX IF NOT EXISTS idx_task_runs_dag_run_id ON task_runs(dag_run_id);
`;
const SCHEMA_V2_SQL = `
  ALTER TABLE task_runs ADD COLUMN reserved_credits REAL;
  ALTER TABLE task_runs ADD COLUMN reservation_attempt INTEGER;
  ALTER TABLE task_runs ADD COLUMN reservation_owner TEXT;
`;

/** Builds a database file whose schema is frozen at v2 (no lineage_json column), with the
 * schema_migrations bookkeeping already recording versions 1 and 2 as applied — exactly what a
 * worker on an older release left on disk. */
function buildSchemaV2Database(dbPath: string, run: { dagRunId: string; runKey: string }): void {
  const raw = new DatabaseConstructor(dbPath);
  try {
    raw.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
    raw.exec(SCHEMA_V1_SQL);
    raw.exec(SCHEMA_V2_SQL);
    raw
      .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(1, Date.now());
    raw
      .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(2, Date.now());
    raw
      .prepare(
        `INSERT INTO dag_runs
         (dag_run_id, dag_id, version, status, run_key, logical_date, trigger)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(run.dagRunId, 'dag-1', 1, 'created', run.runKey, '2026-01-01T00:00:00.000Z', 'manual');
  } finally {
    raw.close();
  }
}

describe('SqliteStorageAdapter schema migration to v3', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dag-adapters-sqlite-migration-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('migrates a v2 database to v3 and reads pre-existing runs with lineage undefined', async () => {
    const dbPath = path.join(dir, 'legacy.sqlite');
    buildSchemaV2Database(dbPath, { dagRunId: 'legacy-run', runKey: 'legacy-key' });

    const adapter = new SqliteStorageAdapter(dbPath);
    try {
      const run = await adapter.getDagRun('legacy-run');
      expect(run).toBeDefined();
      expect(run?.status).toBe('created');
      expect(run?.lineage).toBeUndefined();

      // The new column is usable going forward, on the same migrated database.
      const lineage = {
        rootRunId: 'root', parentRunId: 'parent', depth: 1, ancestorCompositeNodeTypes: ['outer'],
      };
      await adapter.createDagRun({
        dagRunId: 'new-run', dagId: 'dag-1', version: 1, status: 'created',
        runKey: 'new-key', logicalDate: '2026-01-01T00:00:00.000Z', trigger: 'manual', lineage,
      });
      expect((await adapter.getDagRun('new-run'))?.lineage).toEqual(lineage);
    } finally {
      adapter.close();
    }
  });
});

describe('SqliteStorageAdapter fails closed on malformed persisted lineage', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dag-adapters-sqlite-malformed-lineage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not throw reading a row with invalid JSON text in lineage_json', async () => {
    const dbPath = path.join(dir, 'malformed.sqlite');
    const adapter = new SqliteStorageAdapter(dbPath);
    try {
      await adapter.createDagRun(makeDagRun({ dagRunId: 'run-1', runKey: 'key-1' }));
      // Simulate on-disk corruption: something that is not JSON at all.
      const raw = new DatabaseConstructor(dbPath);
      raw.prepare('UPDATE dag_runs SET lineage_json = ? WHERE dag_run_id = ?').run('not-json{{', 'run-1');
      raw.close();

      // The adapter must not throw here — a malformed row is deferred to the caller's decode.
      const run = await adapter.getDagRun('run-1');
      expect(run).toBeDefined();
      // The stored value is handed through unvalidated; it is the caller's decode that must reject it.
      const { decodeDagExecutionLineage } = await import('@robota-sdk/dag-core');
      expect(() => decodeDagExecutionLineage(run?.lineage)).toThrow(
        'Invalid persisted DAG execution lineage',
      );
    } finally {
      adapter.close();
    }
  });

  it('does not throw reading a row with structurally invalid (but valid-JSON) lineage', async () => {
    const dbPath = path.join(dir, 'malformed-fields.sqlite');
    const adapter = new SqliteStorageAdapter(dbPath);
    try {
      await adapter.createDagRun(makeDagRun({ dagRunId: 'run-1', runKey: 'key-1' }));
      const raw = new DatabaseConstructor(dbPath);
      // Valid JSON, but depth/ancestors length mismatch and an empty rootRunId.
      raw
        .prepare('UPDATE dag_runs SET lineage_json = ? WHERE dag_run_id = ?')
        .run(
          JSON.stringify({
            rootRunId: '', parentRunId: 'parent', depth: 2, ancestorCompositeNodeTypes: ['only-one'],
          }),
          'run-1',
        );
      raw.close();

      const run = await adapter.getDagRun('run-1');
      expect(run).toBeDefined();
      const { decodeDagExecutionLineage } = await import('@robota-sdk/dag-core');
      expect(() => decodeDagExecutionLineage(run?.lineage)).toThrow(
        'Invalid persisted DAG execution lineage',
      );
    } finally {
      adapter.close();
    }
  });
});
