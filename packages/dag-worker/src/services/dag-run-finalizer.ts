import {
  EXECUTION_PROGRESS_EVENTS,
  buildTaskExecutionError,
  buildValidationError,
  type IClockPort,
  type IDagError,
  type IRunProgressEventReporter,
  type IStoragePort,
  type ITaskRun,
  type TResult,
} from '@robota-sdk/dag-core';

/**
 * Checks whether all tasks in a DAG run have reached a terminal state
 * and transitions the DAG run accordingly. Publishes completion or
 * failure progress events when the run finalizes.
 *
 * @param dagRunId - The DAG run to evaluate.
 * @param storage - Storage port for reading/writing run state.
 * @param clock - Clock port for timestamps.
 * @param reporter - Optional progress event reporter.
 * @returns Success if finalized or still running, error if the run is not found.
 */
export async function finalizeDagRunIfTerminal(
  dagRunId: string,
  storage: IStoragePort,
  clock: IClockPort,
  reporter?: IRunProgressEventReporter,
): Promise<TResult<void, IDagError>> {
  const committed = await storage.commitExecution(dagRunId, {
    kind: 'finalize',
    endedAt: clock.nowIso(),
  });
  if (committed.runStatus === undefined) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
        'DagRun not found while finalizing run status',
        { dagRunId },
      ),
    };
  }
  if (!committed.applied) return { ok: true, value: undefined };
  const hasFailure = committed.runStatus === 'failed';
  const taskRuns = await storage.listTaskRunsByDagRunId(dagRunId);
  if (hasFailure) {
    publishFailureEvent(dagRunId, taskRuns, clock, reporter);
  } else {
    reporter?.publish({
      dagRunId,
      eventType: EXECUTION_PROGRESS_EVENTS.COMPLETED,
      occurredAt: clock.nowIso(),
    });
  }

  return { ok: true, value: undefined };
}

/** Publishes a failure progress event with error details from the first failed task. */
function publishFailureEvent(
  dagRunId: string,
  taskRuns: ITaskRun[],
  clock: IClockPort,
  reporter?: IRunProgressEventReporter,
): void {
  const failedTaskRun = taskRuns.find((taskRun) => taskRun.status === 'failed');
  const failedError =
    typeof failedTaskRun?.errorCode === 'string' && typeof failedTaskRun.errorMessage === 'string'
      ? buildTaskExecutionError(failedTaskRun.errorCode, failedTaskRun.errorMessage, false, {
          dagRunId,
          taskRunId: failedTaskRun.taskRunId,
          nodeId: failedTaskRun.nodeId,
        })
      : buildTaskExecutionError('DAG_TASK_EXECUTION_FAILED', 'Run completed with failure.', false, {
          dagRunId,
        });

  reporter?.publish({
    dagRunId,
    eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
    occurredAt: clock.nowIso(),
    error: failedError,
  });
}
