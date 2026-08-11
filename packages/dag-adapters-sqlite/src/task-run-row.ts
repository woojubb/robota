import type { ITaskRun, TTaskRunStatus } from '@robota-sdk/dag-core';

/** The `task_runs` row shape, shared by the adapter and the DAG-001 recovery queries. */
export interface ITaskRunRow {
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

export function rowToTaskRun(row: ITaskRunRow): ITaskRun {
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
