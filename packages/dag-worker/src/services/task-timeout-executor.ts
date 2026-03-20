import {
    buildTaskExecutionError,
    type IDagError,
    type ITaskExecutionInput,
    type ITaskExecutorPort,
    type TTaskExecutionResult
} from '@robota-sdk/dag-core';

/** Builds a timeout error for a task that exceeded its allowed execution time. */
function buildTimeoutError(taskRunId: string, timeoutMs: number): IDagError {
    return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_TIMEOUT',
        `Task execution timed out after ${timeoutMs}ms`,
        true,
        { taskRunId, timeoutMs }
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
 * Executes a task with a timeout guard. When the timeout fires, the promise resolves
 * with a timeout error, but the underlying executor continues running in the background.
 * The executor result is discarded if it completes after timeout.
 *
 * Limitation: the executor is not aborted on timeout. True cancellation would require
 * AbortController integration in `ITaskExecutorPort.execute`, which is a larger change.
 *
 * @param executor - The task executor port.
 * @param input - The task execution input.
 * @param timeoutMs - Maximum execution time in milliseconds.
 * @param taskRunId - The task run identifier for error reporting.
 * @returns The execution result or a timeout/exception error.
 */
export function executeWithTimeout(
    executor: ITaskExecutorPort,
    input: ITaskExecutionInput,
    timeoutMs: number,
    taskRunId: string
): Promise<TTaskExecutionResult> {
    return new Promise((resolve) => {
        let settled = false;

        const timeoutId = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            resolve({
                ok: false,
                error: buildTimeoutError(taskRunId, timeoutMs)
            });
        }, timeoutMs);

        executor.execute(input)
            .then((result) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch((error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                resolve({
                    ok: false,
                    error: buildTaskExecutionError(
                        'DAG_TASK_EXECUTION_EXCEPTION',
                        'Task executor threw an exception',
                        true,
                        {
                            taskRunId,
                            errorMessage: resolveErrorMessage(error)
                        }
                    )
                });
            });
    });
}
