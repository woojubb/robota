import {
  buildTaskExecutionError,
  buildTaskCancellationError,
  type IDagError,
  type ITaskExecutionInput,
  type ITaskExecutorPort,
  type TTaskExecutionResult,
} from '@robota-sdk/dag-core';

/** Builds a timeout error for a task that exceeded its allowed execution time. */
function buildTimeoutError(taskRunId: string, timeoutMs: number): IDagError {
  return buildTaskExecutionError(
    'DAG_TASK_EXECUTION_TIMEOUT',
    `Task execution timed out after ${timeoutMs}ms`,
    true,
    { taskRunId, timeoutMs },
  );
}

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * Gives each attempt its own signal and aborts it before settling a timeout.
 * Cooperative executors can stop their work; late results are discarded even when
 * an executor ignores cancellation. This is not CPU preemption or a cleanup join.
 */
export function executeWithTimeout(
  executor: ITaskExecutorPort,
  input: ITaskExecutionInput,
  timeoutMs: number,
  taskRunId: string,
): Promise<TTaskExecutionResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: TTaskExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      input.signal?.removeEventListener('abort', cancel);
      resolve(result);
    };
    const abort = (error: IDagError): void => {
      if (settled) return;
      // Claim the outcome before invoking user abort listeners. Reentrant completion
      // must not replace the timeout/cancellation that triggered those listeners.
      finish({ ok: false, error });
      controller.abort(error);
    };
    const cancel = (): void => abort(buildTaskCancellationError(taskRunId));
    if (input.signal?.aborted) {
      cancel();
      return;
    }
    input.signal?.addEventListener('abort', cancel, { once: true });
    timeoutId = setTimeout(() => abort(buildTimeoutError(taskRunId, timeoutMs)), timeoutMs);
    const fail = (error: unknown): void =>
      finish({
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_EXCEPTION',
          'Task executor threw an exception',
          true,
          { taskRunId, errorMessage: resolveErrorMessage(error) },
        ),
      });
    try {
      executor.execute({ ...input, signal: controller.signal }).then(finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}
