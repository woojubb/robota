import type { ITaskRun } from '@robota-sdk/dag-core';

/**
 * The task-run operations a crash-recovery path needs, as pure edits to a task map. DAG-001.
 *
 * Shared by the in-memory and file adapters, which both work through this map — one copy of "which
 * task counts as abandoned", because two could disagree and a task nobody agrees is stuck is a task
 * nobody recovers.
 *
 * DAG-003 changed what that map's LIFETIME is for the file adapter. This docblock used to say it
 * "persists definitions only, so the crash recovery built on these functions has nothing to read
 * after a real restart" — true when written, false since, and left standing for a review round after
 * the change that falsified it. `FileStoragePort` now hydrates this map from disk and persists it
 * after every mutation, so the recovery path has state under it. These functions do not know or care:
 * they edit the map, and the port owns when the result reaches disk.
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

/**
 * Merge the snapshot/credit fields onto a task run, leaving absent arguments untouched.
 *
 * Beside `applyTaskRunLease` because it is the same kind of thing — a pure edit to the task-run Map,
 * with the port owning only when it happens and when it reaches disk. Moved here when the port passed
 * its size ceiling; the boundary was already drawn by the module that held the other two.
 */
export function applyTaskRunSnapshots(
  taskRuns: Map<string, ITaskRun>,
  taskRunId: string,
  inputSnapshot?: string,
  outputSnapshot?: string,
  estimatedCredits?: number,
  totalCredits?: number,
): boolean {
  for (const [key, taskRun] of taskRuns.entries()) {
    if (taskRun.taskRunId !== taskRunId) continue;
    taskRuns.set(key, {
      ...taskRun,
      inputSnapshot: typeof inputSnapshot === 'string' ? inputSnapshot : taskRun.inputSnapshot,
      outputSnapshot: typeof outputSnapshot === 'string' ? outputSnapshot : taskRun.outputSnapshot,
      estimatedCredits:
        typeof estimatedCredits === 'number' ? estimatedCredits : taskRun.estimatedCredits,
      totalCredits: typeof totalCredits === 'number' ? totalCredits : taskRun.totalCredits,
    });
    return true;
  }
  return false;
}

/**
 * Advance a task run's attempt counter.
 *
 * The retry LIMIT is counted from this value, so the caller must persist the result — leaving it in
 * memory let a crash mid-retry-loop reset the count and a task retry past its configured maximum.
 * Returns whether anything changed, so the caller does not write on a miss.
 */
export function applyTaskAttemptIncrement(
  taskRuns: Map<string, ITaskRun>,
  taskRunId: string,
): boolean {
  for (const [key, taskRun] of taskRuns.entries()) {
    if (taskRun.taskRunId !== taskRunId) continue;
    taskRuns.set(key, { ...taskRun, attempt: taskRun.attempt + 1 });
    return true;
  }
  return false;
}
