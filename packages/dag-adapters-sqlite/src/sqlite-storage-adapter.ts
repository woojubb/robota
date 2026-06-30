import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type {
  IDagDefinition,
  IDagError,
  IDagRun,
  IStoragePort,
  ITaskRun,
  TDagRunStatus,
  TTaskRunStatus,
} from '@robota-sdk/dag-core';
import { runMigrations } from './migrations.js';

interface IDefinitionRow {
  dag_id: string;
  version: number;
  status: string;
  definition_json: string;
}

interface IDagRunRow {
  dag_run_id: string;
  dag_id: string;
  version: number;
  status: string;
  run_key: string;
  logical_date: string;
  trigger: string;
  definition_snapshot: string | null;
  input_snapshot: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface ITaskRunRow {
  task_run_id: string;
  dag_run_id: string;
  node_id: string;
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_until: string | null;
  input_snapshot: string | null;
  output_snapshot: string | null;
  estimated_credits: number | null;
  total_credits: number | null;
  error_code: string | null;
  error_message: string | null;
}

function rowToDefinition(row: IDefinitionRow): IDagDefinition {
  return JSON.parse(row.definition_json) as IDagDefinition;
}

function rowToDagRun(row: IDagRunRow): IDagRun {
  return {
    dagRunId: row.dag_run_id,
    dagId: row.dag_id,
    version: row.version,
    status: row.status as TDagRunStatus,
    runKey: row.run_key,
    logicalDate: row.logical_date,
    trigger: row.trigger as IDagRun['trigger'],
    definitionSnapshot: row.definition_snapshot ?? undefined,
    inputSnapshot: row.input_snapshot ?? undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
  };
}

function rowToTaskRun(row: ITaskRunRow): ITaskRun {
  return {
    taskRunId: row.task_run_id,
    dagRunId: row.dag_run_id,
    nodeId: row.node_id,
    status: row.status as TTaskRunStatus,
    attempt: row.attempt,
    leaseOwner: row.lease_owner ?? undefined,
    leaseUntil: row.lease_until ?? undefined,
    inputSnapshot: row.input_snapshot ?? undefined,
    outputSnapshot: row.output_snapshot ?? undefined,
    estimatedCredits: row.estimated_credits ?? undefined,
    totalCredits: row.total_credits ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

/**
 * SQLite-backed implementation of IStoragePort.
 * Uses better-sqlite3 for synchronous DB access wrapped in async interface.
 * Runs schema migrations automatically on construction.
 */
export class SqliteStorageAdapter implements IStoragePort {
  private readonly db: Database.Database;

  public constructor(dbPath = './robota-dag.db') {
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
  }

  public close(): void {
    this.db.close();
  }

  public async saveDefinition(definition: IDagDefinition): Promise<void> {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO dag_definitions (dag_id, version, status, definition_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (dag_id, version) DO UPDATE SET
           status = excluded.status,
           definition_json = excluded.definition_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        definition.dagId,
        definition.version,
        definition.status,
        JSON.stringify(definition),
        now,
        now,
      );
  }

  public async getDefinition(dagId: string, version: number): Promise<IDagDefinition | undefined> {
    const row = this.db
      .prepare<
        [string, number],
        IDefinitionRow
      >('SELECT * FROM dag_definitions WHERE dag_id = ? AND version = ?')
      .get(dagId, version);
    return row ? rowToDefinition(row) : undefined;
  }

  public async listDefinitions(): Promise<IDagDefinition[]> {
    const rows = this.db
      .prepare<[], IDefinitionRow>('SELECT * FROM dag_definitions ORDER BY dag_id, version')
      .all();
    return rows.map(rowToDefinition);
  }

  public async listDefinitionsByDagId(dagId: string): Promise<IDagDefinition[]> {
    const rows = this.db
      .prepare<
        [string],
        IDefinitionRow
      >('SELECT * FROM dag_definitions WHERE dag_id = ? ORDER BY version')
      .all(dagId);
    return rows.map(rowToDefinition);
  }

  public async getLatestPublishedDefinition(dagId: string): Promise<IDagDefinition | undefined> {
    const row = this.db
      .prepare<[string], IDefinitionRow>(
        `SELECT * FROM dag_definitions
         WHERE dag_id = ? AND status = 'published'
         ORDER BY version DESC LIMIT 1`,
      )
      .get(dagId);
    return row ? rowToDefinition(row) : undefined;
  }

  public async deleteDefinition(dagId: string, version: number): Promise<void> {
    this.db
      .prepare('DELETE FROM dag_definitions WHERE dag_id = ? AND version = ?')
      .run(dagId, version);
  }

  public async createDagRun(dagRun: IDagRun): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO dag_runs
         (dag_run_id, dag_id, version, status, run_key, logical_date, trigger,
          definition_snapshot, input_snapshot, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dagRun.dagRunId,
        dagRun.dagId,
        dagRun.version,
        dagRun.status,
        dagRun.runKey,
        dagRun.logicalDate,
        dagRun.trigger,
        dagRun.definitionSnapshot ?? null,
        dagRun.inputSnapshot ?? null,
        dagRun.startedAt ?? null,
        dagRun.endedAt ?? null,
      );
  }

  public async getDagRun(dagRunId: string): Promise<IDagRun | undefined> {
    const row = this.db
      .prepare<[string], IDagRunRow>('SELECT * FROM dag_runs WHERE dag_run_id = ?')
      .get(dagRunId);
    return row ? rowToDagRun(row) : undefined;
  }

  public async listDagRuns(): Promise<IDagRun[]> {
    const rows = this.db
      .prepare<[], IDagRunRow>('SELECT * FROM dag_runs ORDER BY dag_run_id')
      .all();
    return rows.map(rowToDagRun);
  }

  public async getDagRunByRunKey(runKey: string): Promise<IDagRun | undefined> {
    const row = this.db
      .prepare<[string], IDagRunRow>('SELECT * FROM dag_runs WHERE run_key = ?')
      .get(runKey);
    return row ? rowToDagRun(row) : undefined;
  }

  public async updateDagRunStatus(
    dagRunId: string,
    status: TDagRunStatus,
    endedAt?: string,
  ): Promise<void> {
    this.db
      .prepare('UPDATE dag_runs SET status = ?, ended_at = ? WHERE dag_run_id = ?')
      .run(status, endedAt ?? null, dagRunId);
  }

  public async deleteDagRun(dagRunId: string): Promise<void> {
    this.db.prepare('DELETE FROM dag_runs WHERE dag_run_id = ?').run(dagRunId);
  }

  public async createTaskRun(taskRun: ITaskRun): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO task_runs
         (task_run_id, dag_run_id, node_id, status, attempt, lease_owner, lease_until,
          input_snapshot, output_snapshot, estimated_credits, total_credits, error_code, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        taskRun.taskRunId,
        taskRun.dagRunId,
        taskRun.nodeId,
        taskRun.status,
        taskRun.attempt,
        taskRun.leaseOwner ?? null,
        taskRun.leaseUntil ?? null,
        taskRun.inputSnapshot ?? null,
        taskRun.outputSnapshot ?? null,
        taskRun.estimatedCredits ?? null,
        taskRun.totalCredits ?? null,
        taskRun.errorCode ?? null,
        taskRun.errorMessage ?? null,
      );
  }

  public async getTaskRun(taskRunId: string): Promise<ITaskRun | undefined> {
    const row = this.db
      .prepare<[string], ITaskRunRow>('SELECT * FROM task_runs WHERE task_run_id = ?')
      .get(taskRunId);
    return row ? rowToTaskRun(row) : undefined;
  }

  public async listTaskRunsByDagRunId(dagRunId: string): Promise<ITaskRun[]> {
    const rows = this.db
      .prepare<[string], ITaskRunRow>('SELECT * FROM task_runs WHERE dag_run_id = ?')
      .all(dagRunId);
    return rows.map(rowToTaskRun);
  }

  public async deleteTaskRunsByDagRunId(dagRunId: string): Promise<void> {
    this.db.prepare('DELETE FROM task_runs WHERE dag_run_id = ?').run(dagRunId);
  }

  public async updateTaskRunStatus(
    taskRunId: string,
    status: TTaskRunStatus,
    error?: IDagError,
  ): Promise<void> {
    this.db
      .prepare(
        'UPDATE task_runs SET status = ?, error_code = ?, error_message = ? WHERE task_run_id = ?',
      )
      .run(status, error?.code ?? null, error?.message ?? null, taskRunId);
  }

  public async saveTaskRunSnapshots(
    taskRunId: string,
    inputSnapshot?: string,
    outputSnapshot?: string,
    estimatedCredits?: number,
    totalCredits?: number,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE task_runs SET
           input_snapshot    = COALESCE(?, input_snapshot),
           output_snapshot   = COALESCE(?, output_snapshot),
           estimated_credits = COALESCE(?, estimated_credits),
           total_credits     = COALESCE(?, total_credits)
         WHERE task_run_id = ?`,
      )
      .run(
        inputSnapshot ?? null,
        outputSnapshot ?? null,
        estimatedCredits ?? null,
        totalCredits ?? null,
        taskRunId,
      );
  }

  public async incrementTaskAttempt(taskRunId: string): Promise<void> {
    this.db
      .prepare('UPDATE task_runs SET attempt = attempt + 1 WHERE task_run_id = ?')
      .run(taskRunId);
  }
}
