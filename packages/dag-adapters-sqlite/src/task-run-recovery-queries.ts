import type { ITaskRun } from '@robota-sdk/dag-core';
import type { Database } from 'better-sqlite3';

import { type ITaskRunRow, rowToTaskRun } from './task-run-row.js';

/**
 * The two task-run queries a crash-recovery path needs. DAG-001.
 *
 * Split out of the storage adapter because they answer a different question from the rest of it:
 * everything else there persists and reads the happy path, while these two exist only to find and
 * hand back work a dead worker left behind.
 */

/**
 * Record or clear which worker holds a task, and until when.
 *
 * The `lease_owner` / `lease_until` columns have existed since the first migration and the INSERT has
 * always copied them — from a record that never had them set. Ghost columns: present in the schema,
 * present in the type, written by nothing. This is the writer they were missing.
 */
export function setTaskRunLeaseRow(
  db: Database,
  taskRunId: string,
  leaseOwner?: string,
  leaseUntil?: string,
): void {
  db.prepare('UPDATE task_runs SET lease_owner = ?, lease_until = ? WHERE task_run_id = ?').run(
    leaseOwner ?? null,
    leaseUntil ?? null,
    taskRunId,
  );
}

/**
 * Tasks left `running` by a worker that never came back.
 *
 * `lease_until IS NULL` is included deliberately — a `running` task with no lease recorded was
 * orphaned before its lease was written, or by a worker predating this column. Excluding it would
 * leave exactly the tasks with the least evidence permanently stuck, which is the defect this query
 * exists to end. Lease timestamps are ISO-8601 UTC, so a string comparison is a time comparison.
 */
export function listStaleRunningTaskRunRows(db: Database, asOfIso: string): ITaskRun[] {
  const rows = db
    .prepare<[string], ITaskRunRow>(
      "SELECT * FROM task_runs WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= ?)",
    )
    .all(asOfIso);
  return rows.map(rowToTaskRun);
}
