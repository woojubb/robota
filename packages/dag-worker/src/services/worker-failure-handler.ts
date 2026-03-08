import {
    TaskRunStateMachine,
    buildDispatchError,
    buildValidationError,
    type IClockPort,
    type IDagError,
    type IQueueMessage,
    type IQueuePort,
    type IStoragePort,
    type IRunProgressEventReporter,
    type TResult
} from '@robota-sdk/dag-core';
import { replaceAttemptSegment } from '../utils/execution-path.js';
import { finalizeDagRunIfTerminal } from './dag-run-finalizer.js';
import type { IWorkerLoopOptions, IWorkerLoopResult } from './worker-loop-service.js';

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return 'Unknown error';
}

/** Handles a terminal task failure including dead-letter routing and run finalization. */
export async function handleTerminalFailure(
    message: IQueueMessage,
    _taskRunId: string,
    error: IDagError,
    options: IWorkerLoopOptions,
    storage: IStoragePort,
    queue: IQueuePort,
    clock: IClockPort,
    runProgressEventReporter?: IRunProgressEventReporter
): Promise<TResult<IWorkerLoopResult, IDagError>> {
    if (options.deadLetterEnabled) {
        const deadLettered = await enqueueDeadLetter(message, error, options, clock);
        if (!deadLettered.ok) {
            return failAfterAck(queue, message.messageId, deadLettered.error);
        }
    }

    const finalized = await finalizeDagRunIfTerminal(
        message.dagRunId, storage, clock, runProgressEventReporter
    );
    if (!finalized.ok) {
        return failAfterAck(queue, message.messageId, finalized.error);
    }

    return successAfterAck(queue, message.messageId, _taskRunId, false);
}

/** Handles retry by re-enqueuing the message with an incremented attempt. */
export async function handleRetry(
    message: IQueueMessage,
    taskRunId: string,
    storage: IStoragePort,
    queue: IQueuePort,
    clock: IClockPort
): Promise<TResult<IWorkerLoopResult, IDagError>> {
    const retryTransition = TaskRunStateMachine.transition('failed', 'RETRY');
    if (!retryTransition.ok) {
        return failAfterAck(queue, message.messageId, retryTransition.error);
    }

    await storage.incrementTaskAttempt(taskRunId);
    await storage.updateTaskRunStatus(taskRunId, retryTransition.value.nextStatus);

    const nextAttempt = message.attempt + 1;
    const nextMessage: IQueueMessage = {
        ...message,
        messageId: `${message.taskRunId}:message:${nextAttempt}`,
        attempt: nextAttempt,
        executionPath: replaceAttemptSegment(message.executionPath, nextAttempt),
        createdAt: clock.nowIso()
    };

    try {
        await queue.enqueue(nextMessage);
    } catch (error) {
        return failAfterAck(
            queue,
            message.messageId,
            buildDispatchError(
                'DAG_DISPATCH_ENQUEUE_RETRY_FAILED',
                'Failed to enqueue retry message',
                { taskRunId, attempt: nextAttempt, errorMessage: resolveErrorMessage(error) }
            )
        );
    }

    return successAfterAck(queue, message.messageId, taskRunId, true);
}

async function enqueueDeadLetter(
    message: IQueueMessage,
    error: IDagError,
    options: IWorkerLoopOptions,
    clock: IClockPort
): Promise<TResult<void, IDagError>> {
    if (!options.deadLetterQueue) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_DEAD_LETTER_QUEUE_NOT_CONFIGURED',
                'deadLetterEnabled requires deadLetterQueue to be configured',
                { taskRunId: message.taskRunId }
            )
        };
    }

    const deadLetterMessage: IQueueMessage = {
        ...message,
        messageId: `${message.taskRunId}:dlq:${clock.nowEpochMs()}`,
        payload: {
            ...message.payload,
            dlqReasonCode: error.code,
            dlqReasonMessage: error.message,
            dlqSourceMessageId: message.messageId
        },
        createdAt: clock.nowIso()
    };

    try {
        await options.deadLetterQueue.enqueue(deadLetterMessage);
        return { ok: true, value: undefined };
    } catch (dlqError) {
        return {
            ok: false,
            error: buildDispatchError(
                'DAG_DISPATCH_DEAD_LETTER_ENQUEUE_FAILED',
                'Failed to enqueue dead letter message',
                {
                    taskRunId: message.taskRunId,
                    originalMessageId: message.messageId,
                    errorMessage: resolveErrorMessage(dlqError)
                }
            )
        };
    }
}

/** Acknowledges a message and returns a failure result. */
export async function failAfterAck(queue: IQueuePort, messageId: string, error: IDagError): Promise<TResult<IWorkerLoopResult, IDagError>> {
    await queue.ack(messageId);
    return { ok: false, error };
}

/** Acknowledges a message and returns a success result. */
export async function successAfterAck(queue: IQueuePort, messageId: string, taskRunId: string, retried: boolean): Promise<TResult<IWorkerLoopResult, IDagError>> {
    await queue.ack(messageId);
    return { ok: true, value: { processed: true, taskRunId, retried } };
}
