import type {
    IClockPort,
    IDagError,
    ILeasePort,
    IQueueMessage,
    IQueuePort,
    IStoragePort,
    TResult
} from '@robota-sdk/dag-core';
import {
    TaskRunStateMachine,
    buildDispatchError,
    buildValidationError
} from '@robota-sdk/dag-core';
import { replaceAttemptSegment } from '../utils/execution-path.js';

/** Result of a single dead-letter queue reinjection attempt. */
export interface IDlqReinjectResult {
    reinjected: boolean;
    taskRunId?: string;
}

/**
 * Reprocesses failed tasks by moving messages from the dead-letter queue
 * back to the main processing queue with an incremented attempt number.
 *
 * Acquires a lease on the task run before modifying state to prevent
 * concurrent reinject races when DLQ visibility timeout expires.
 *
 * @see TaskRunStateMachine for retry state transitions
 */
export class DlqReinjectService {
    public constructor(
        private readonly storage: IStoragePort,
        private readonly deadLetterQueue: IQueuePort,
        private readonly mainQueue: IQueuePort,
        private readonly lease: ILeasePort,
        private readonly clock: IClockPort
    ) {}

    /**
     * Dequeues a single message from the dead-letter queue and reinjects it
     * into the main queue for retry processing.
     * @param workerId - The worker identity for queue visibility and lease ownership.
     * @param visibilityTimeoutMs - Visibility timeout for the dequeue operation.
     * @returns The reinjection result, or an error if the task run is not found or retry is disallowed.
     */
    public async reinjectOnce(workerId: string, visibilityTimeoutMs: number): Promise<TResult<IDlqReinjectResult, IDagError>> {
        const deadLetterMessage = await this.deadLetterQueue.dequeue(workerId, visibilityTimeoutMs);
        if (!deadLetterMessage) {
            return {
                ok: true,
                value: {
                    reinjected: false
                }
            };
        }

        const leaseKey = `taskRun:${deadLetterMessage.taskRunId}`;
        const acquired = await this.lease.acquire(leaseKey, workerId, visibilityTimeoutMs);
        if (!acquired) {
            await this.deadLetterQueue.nack(deadLetterMessage.messageId);
            return {
                ok: true,
                value: {
                    reinjected: false
                }
            };
        }

        try {
            return await this.processReinject(deadLetterMessage, workerId);
        } finally {
            await this.lease.release(leaseKey, workerId);
        }
    }

    private async processReinject(
        deadLetterMessage: IQueueMessage,
        _workerId: string
    ): Promise<TResult<IDlqReinjectResult, IDagError>> {
        const taskRun = await this.storage.getTaskRun(deadLetterMessage.taskRunId);
        if (!taskRun) {
            await this.deadLetterQueue.nack(deadLetterMessage.messageId);
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_TASK_RUN_NOT_FOUND',
                    'TaskRun not found for dead letter reinject',
                    { taskRunId: deadLetterMessage.taskRunId }
                )
            };
        }

        const retryTransition = TaskRunStateMachine.transition(taskRun.status, 'RETRY');
        if (!retryTransition.ok) {
            await this.deadLetterQueue.nack(deadLetterMessage.messageId);
            return retryTransition;
        }

        await this.storage.incrementTaskAttempt(taskRun.taskRunId);
        await this.storage.updateTaskRunStatus(taskRun.taskRunId, retryTransition.value.nextStatus);
        const nextAttempt = taskRun.attempt + 1;

        const reinjectedMessage: IQueueMessage = {
            ...deadLetterMessage,
            messageId: `${deadLetterMessage.taskRunId}:reinject:${this.clock.nowEpochMs()}`,
            attempt: nextAttempt,
            executionPath: replaceAttemptSegment(deadLetterMessage.executionPath, nextAttempt),
            createdAt: this.clock.nowIso()
        };

        try {
            await this.mainQueue.enqueue(reinjectedMessage);
            await this.deadLetterQueue.ack(deadLetterMessage.messageId);
            return {
                ok: true,
                value: {
                    reinjected: true,
                    taskRunId: reinjectedMessage.taskRunId
                }
            };
        } catch {
            await this.deadLetterQueue.nack(deadLetterMessage.messageId);
            return {
                ok: false,
                error: buildDispatchError(
                    'DAG_DISPATCH_REINJECT_ENQUEUE_FAILED',
                    'Failed to enqueue reinjected dead letter message',
                    { taskRunId: deadLetterMessage.taskRunId }
                )
            };
        }
    }
}
