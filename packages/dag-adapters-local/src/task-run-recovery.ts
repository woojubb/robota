import type { ITaskRun } from '@robota-sdk/dag-core';

/**
 * The two task-run operations a crash-recovery path needs, over an in-memory task map. DAG-001.
 *
 * Shared by the in-memory and file adapters, which hold their task runs the same way — in memory.
 * For the FILE adapter that is a durability gap, not a detail: it persists definitions only, so the
 * crash recovery built on these functions has nothing to read after a real restart (DAG-003). Two copies of
 * "which task counts as abandoned" could disagree, and a task nobody agrees is stuck is a task nobody
 * recovers — which is the defect this closes.
 */

/** Record or clear which worker holds a task, and until when. */
export function applyTaskRunLease(
  taskRuns: Map<string, ITaskRun>,
  taskRunId: string,
  leaseOwner?: string,
  leaseUntil?: string,
): void {
  for (const [key, taskRun] of taskRuns.entries()) {
    if (taskRun.taskRunId !== taskRunId) {
      continue;
    }
    taskRuns.set(key, { ...taskRun, leaseOwner, leaseUntil });
    return;
  }
}

/**
 * Tasks left `running` by a worker that never came back.
 *
 * A `running` task with NO lease recorded counts as stale: it was orphaned before its lease was
 * written, or by a worker predating the field. Excluding it would leave exactly the tasks with the
 * least evidence permanently stuck.
 */
export function selectStaleRunningTaskRuns(
  taskRuns: Map<string, ITaskRun>,
  asOfIso: string,
): ITaskRun[] {
  return [...taskRuns.values()].filter(
    (taskRun) =>
      taskRun.status === 'running' &&
      (taskRun.leaseUntil === undefined || taskRun.leaseUntil <= asOfIso),
  );
}
