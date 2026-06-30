import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { IQueueMessage, IQueuePort } from '@robota-sdk/dag-core';
import { runMigrations } from './migrations.js';

interface IQueueRow {
  message_id: string;
  dag_run_id: string;
  task_run_id: string;
  node_id: string;
  attempt: number;
  execution_path_json: string;
  payload_json: string;
  created_at: string;
  visible_after: number;
  in_flight: number;
  worker_id: string | null;
}

function rowToMessage(row: IQueueRow): IQueueMessage {
  return {
    messageId: row.message_id,
    dagRunId: row.dag_run_id,
    taskRunId: row.task_run_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    executionPath: JSON.parse(row.execution_path_json) as string[],
    payload: JSON.parse(row.payload_json) as IQueueMessage['payload'],
    createdAt: row.created_at,
  };
}

/**
 * SQLite-backed implementation of IQueuePort.
 * Supports visibility timeouts via a `visible_after` epoch-ms column.
 */
export class SqliteQueueAdapter implements IQueuePort {
  private readonly db: Database.Database;

  public constructor(dbPath = './robota-dag.db') {
    this.db = new DatabaseConstructor(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
    this.ensureQueueTable();
  }

  private ensureQueueTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_queue (
        message_id          TEXT PRIMARY KEY,
        dag_run_id          TEXT NOT NULL,
        task_run_id         TEXT NOT NULL,
        node_id             TEXT NOT NULL,
        attempt             INTEGER NOT NULL,
        execution_path_json TEXT NOT NULL,
        payload_json        TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        visible_after       INTEGER NOT NULL DEFAULT 0,
        in_flight           INTEGER NOT NULL DEFAULT 0,
        worker_id           TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_queue_visible ON task_queue(visible_after, in_flight);
    `);
  }

  public close(): void {
    this.db.close();
  }

  public async enqueue(message: IQueueMessage): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO task_queue
         (message_id, dag_run_id, task_run_id, node_id, attempt,
          execution_path_json, payload_json, created_at, visible_after, in_flight, worker_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL)`,
      )
      .run(
        message.messageId,
        message.dagRunId,
        message.taskRunId,
        message.nodeId,
        message.attempt,
        JSON.stringify(message.executionPath),
        JSON.stringify(message.payload),
        message.createdAt,
      );
  }

  public async dequeue(
    workerId: string,
    visibilityTimeoutMs: number,
    waitTimeoutMs = 0,
  ): Promise<IQueueMessage | undefined> {
    const deadline = Date.now() + waitTimeoutMs;

    const tryOnce = (): IQueueMessage | undefined => {
      const now = Date.now();
      const row = this.db
        .prepare<[number], IQueueRow>(
          `SELECT * FROM task_queue
           WHERE in_flight = 0 AND visible_after <= ?
           ORDER BY visible_after ASC LIMIT 1`,
        )
        .get(now);
      if (!row) return undefined;

      const visibleAfter = now + visibilityTimeoutMs;
      const updated = this.db
        .prepare(
          `UPDATE task_queue
           SET in_flight = 1, visible_after = ?, worker_id = ?
           WHERE message_id = ? AND in_flight = 0`,
        )
        .run(visibleAfter, workerId, row.message_id);

      return updated.changes > 0 ? rowToMessage(row) : undefined;
    };

    const result = tryOnce();
    if (result) return result;
    if (waitTimeoutMs <= 0) return undefined;

    // Spin-poll until deadline (SQLite has no native blocking dequeue)
    const POLL_INTERVAL_MS = 50;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const polled = tryOnce();
      if (polled) return polled;
    }
    return undefined;
  }

  public async ack(messageId: string): Promise<void> {
    this.db.prepare('DELETE FROM task_queue WHERE message_id = ?').run(messageId);
  }

  public async nack(messageId: string): Promise<void> {
    this.db
      .prepare(
        'UPDATE task_queue SET in_flight = 0, visible_after = 0, worker_id = NULL WHERE message_id = ?',
      )
      .run(messageId);
  }
}
