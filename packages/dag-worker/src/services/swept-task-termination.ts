import { TaskRunStateMachine } from '@robota-sdk/dag-core';

import { finalizeDagRunIfTerminal } from './dag-run-finalizer.js';

import type {
  IClockPort,
  IDagError,
  IStoragePort,
  ITaskRun,
  TResult,
  TTaskRunStatus,
} from '@robota-sdk/dag-core';

/**
 * How a swept task STOPS. DAG-001.
 *
 * Split from the sweep itself because landing a task in a terminal status is a different question
 * from deciding which tasks are stale — and because the run-finalization step was omitted here once
 * already, which is easier to notice when it is the file's whole subject.
 */

export /**
 * Land a task in a terminal status and finalize its run — the step the first draft of this branch
 * omitted.
 *
 * Every other path that terminates a task (`handleSuccessPath`, `handleTerminalFailure`) also calls
 * `finalizeDagRunIfTerminal`, because a run only leaves `running` once its last task is terminal.
 * Writing the task's status and stopping meant a swept task that was the run's last pending one left
 * the RUN stuck forever — the same terminal trap DAG-001 exists to close, moved one level up. Review
 * caught it, and noted the sweeper's tests asserted only the task's status, so it was accidental-green
 * on exactly that axis.
 */
async function finishTask(
  storage: IStoragePort,
  clock: IClockPort,
  taskRun: ITaskRun,
  status: TTaskRunStatus,
  error?: IDagError,
): Promise<void> {
  await storage.updateTaskRunStatus(taskRun.taskRunId, status, error);
  await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
  await finalizeDagRunIfTerminal(taskRun.dagRunId, storage, clock);
}

/**
 * Cancel a task whose parent run is gone.
 *
 * Separate from `finishTask` because there is no run to finalize — calling `finalizeDagRunIfTerminal`
 * with a missing run would ask it to reason about a record that does not exist.
 */
export async function finishTaskWithoutRun(
  storage: IStoragePort,
  taskRun: ITaskRun,
): Promise<TResult<void, IDagError>> {
  const cancelled = TaskRunStateMachine.transition(taskRun.status, 'CANCEL');
  if (!cancelled.ok) {
    return cancelled;
  }
  await storage.updateTaskRunStatus(taskRun.taskRunId, cancelled.value.nextStatus, {
    code: 'DAG_TASK_EXECUTION_ORPHANED',
    category: 'task_execution',
    message: `Task's DAG run ${taskRun.dagRunId} no longer exists; the task cannot be run or finalized`,
    retryable: false,
    context: { taskRunId: taskRun.taskRunId, dagRunId: taskRun.dagRunId },
  });
  await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
  return { ok: true, value: undefined };
}
