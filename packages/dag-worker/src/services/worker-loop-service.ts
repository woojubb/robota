import {
    TASK_PROGRESS_EVENTS,
    TaskRunStateMachine,
    buildDispatchError,
    buildLeaseError,
    buildValidationError,
    type IClockPort,
    type IDagDefinition,
    type IDagRun,
    type IDagError,
    type ILeasePort,
    type IQueueMessage,
    type IQueuePort,
    type IStoragePort,
    type ITaskRun,
    type ITaskExecutionInput,
    type ITaskExecutorPort,
    type IRunProgressEventReporter,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { replaceAttemptSegment } from '../utils/execution-path.js';
import { parseDefinitionSnapshot } from './definition-snapshot-parser.js';
import { dispatchDownstreamReadyTasks } from './downstream-task-dispatcher.js';
import { finalizeDagRunIfTerminal } from './dag-run-finalizer.js';
import { executeWithTimeout } from './task-timeout-executor.js';

/** Configuration options for the worker loop, including retry and dead-letter policies. */
export interface IWorkerLoopOptions {
    workerId: string;
    leaseDurationMs: number;
    visibilityTimeoutMs: number;
    retryEnabled: boolean;
    deadLetterEnabled?: boolean;
    deadLetterQueue?: IQueuePort;
    maxAttempts: number;
    defaultTimeoutMs: number;
}

/** Result of a single worker loop iteration. */
export interface IWorkerLoopResult {
    processed: boolean;
    taskRunId?: string;
    retried?: boolean;
}

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return 'Unknown error';
}

/**
 * Processes task messages from the queue one at a time: dequeue, acquire lease,
 * execute via the task executor, handle success/failure paths including retry
 * and dead-letter routing, and finalize the DAG run when all tasks are terminal.
 *
 * @see ITaskExecutorPort for task execution contracts
 * @see ILeasePort for distributed lease contracts
 * @see TaskRunStateMachine for task state transitions
 */
export class WorkerLoopService {
    public constructor(
        private readonly storage: IStoragePort,
        private readonly queue: IQueuePort,
        private readonly lease: ILeasePort,
        private readonly executor: ITaskExecutorPort,
        private readonly clock: IClockPort,
        private readonly options: IWorkerLoopOptions,
        private readonly runProgressEventReporter?: IRunProgressEventReporter
    ) {}

    /**
     * Dequeues and processes a single task message. Acquires a lease before
     * execution and releases it afterwards. Returns `{ processed: false }`
     * when the queue is empty.
     * @returns The processing result or an error if lease acquisition or execution fails.
     */
    public async processOnce(): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const message = await this.queue.dequeue(this.options.workerId, this.options.visibilityTimeoutMs);
        if (!message) {
            return { ok: true, value: { processed: false } };
        }

        const leaseKey = `taskRun:${message.taskRunId}`;
        const acquired = await this.lease.acquire(leaseKey, this.options.workerId, this.options.leaseDurationMs);
        if (!acquired) {
            await this.queue.nack(message.messageId);
            return {
                ok: false,
                error: buildLeaseError(
                    'DAG_LEASE_CONTRACT_VIOLATION',
                    'Failed to acquire lease for task run',
                    { taskRunId: message.taskRunId, workerId: this.options.workerId }
                )
            };
        }

        try {
            return this.processAcquiredMessage(message);
        } finally {
            await this.lease.release(leaseKey, this.options.workerId);
        }
    }

    private async processAcquiredMessage(message: IQueueMessage): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const taskRun = await this.storage.getTaskRun(message.taskRunId);
        if (!taskRun) {
            return this.failAfterAck(
                message.messageId,
                buildValidationError('DAG_VALIDATION_TASK_RUN_NOT_FOUND', 'TaskRun not found for dequeued message', { taskRunId: message.taskRunId })
            );
        }

        const startResult = await this.transitionToRunning(message, taskRun);
        if (!startResult.ok) {
            return this.failAfterAck(message.messageId, startResult.error);
        }

        const dagRun = await this.storage.getDagRun(message.dagRunId);
        if (!dagRun) {
            return this.failAfterAck(
                message.messageId,
                buildValidationError('DAG_VALIDATION_DAG_RUN_NOT_FOUND', 'DagRun not found for dequeued message', { dagRunId: message.dagRunId })
            );
        }

        const definitionResult = parseDefinitionSnapshot(dagRun, message.dagRunId);
        if (!definitionResult.ok) {
            return this.failAfterAck(message.messageId, definitionResult.error);
        }
        const definition = definitionResult.value;

        const nodeDefinition = definition.nodes.find((node) => node.nodeId === message.nodeId);
        if (!nodeDefinition) {
            return this.failAfterAck(
                message.messageId,
                buildValidationError('DAG_VALIDATION_NODE_NOT_FOUND', 'Node definition not found for task execution', { nodeId: message.nodeId, dagId: dagRun.dagId, version: dagRun.version })
            );
        }

        const executionInput = await this.buildExecutionInput(message, dagRun, definition, nodeDefinition);
        const timeoutMs = this.resolveTimeoutMs(message);
        const executionResult = await executeWithTimeout(this.executor, executionInput, timeoutMs, message.taskRunId);

        if (executionResult.ok) {
            return this.handleSuccessPath(
                message, taskRun.taskRunId, dagRun, definition,
                executionResult.output, executionResult.estimatedCostUsd, executionResult.totalCostUsd
            );
        }

        return this.handleFailurePath(message, taskRun.taskRunId, executionResult.error);
    }

    private async transitionToRunning(message: IQueueMessage, taskRun: ITaskRun): Promise<TResult<void, IDagError>> {
        const startTransition = TaskRunStateMachine.transition(taskRun.status, 'START');
        if (!startTransition.ok) {
            return startTransition;
        }
        await this.storage.updateTaskRunStatus(taskRun.taskRunId, startTransition.value.nextStatus);
        this.runProgressEventReporter?.publish({
            dagRunId: message.dagRunId,
            eventType: TASK_PROGRESS_EVENTS.STARTED,
            occurredAt: this.clock.nowIso(),
            taskRunId: taskRun.taskRunId,
            nodeId: message.nodeId,
            input: message.payload
        });
        await this.storage.saveTaskRunSnapshots(taskRun.taskRunId, JSON.stringify(message.payload));
        return { ok: true, value: undefined };
    }

    private async buildExecutionInput(
        message: IQueueMessage,
        dagRun: IDagRun,
        definition: IDagDefinition,
        nodeDefinition: IDagDefinition['nodes'][number]
    ): Promise<ITaskExecutionInput> {
        const allTaskRunsForCost = await this.storage.listTaskRunsByDagRunId(message.dagRunId);
        const currentTotalCostUsd = resolveCurrentTotalCostUsd(allTaskRunsForCost);
        return {
            dagId: dagRun.dagId,
            dagRunId: message.dagRunId,
            taskRunId: message.taskRunId,
            nodeId: message.nodeId,
            attempt: message.attempt,
            executionPath: message.executionPath,
            input: message.payload,
            nodeDefinition,
            costPolicy: definition.costPolicy,
            currentTotalCostUsd
        };
    }

    private async handleSuccessPath(
        message: IQueueMessage,
        taskRunId: string,
        dagRun: IDagRun,
        definition: IDagDefinition,
        output: TPortPayload,
        estimatedCostUsd?: number,
        totalCostUsd?: number
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const completeTransition = TaskRunStateMachine.transition('running', 'COMPLETE_SUCCESS');
        if (!completeTransition.ok) {
            return this.failAfterAck(message.messageId, completeTransition.error);
        }

        await this.storage.updateTaskRunStatus(taskRunId, completeTransition.value.nextStatus);
        await this.storage.saveTaskRunSnapshots(taskRunId, undefined, JSON.stringify(output), estimatedCostUsd, totalCostUsd);
        this.runProgressEventReporter?.publish({
            dagRunId: message.dagRunId,
            eventType: TASK_PROGRESS_EVENTS.COMPLETED,
            occurredAt: this.clock.nowIso(),
            taskRunId,
            nodeId: message.nodeId,
            input: message.payload,
            output
        });

        const dispatched = await dispatchDownstreamReadyTasks(
            dagRun, definition, message.nodeId, output, this.storage, this.queue, this.clock
        );
        if (!dispatched.ok) {
            return this.failAfterAck(message.messageId, dispatched.error);
        }

        const finalized = await finalizeDagRunIfTerminal(
            message.dagRunId, this.storage, this.clock, this.runProgressEventReporter
        );
        if (!finalized.ok) {
            return this.failAfterAck(message.messageId, finalized.error);
        }

        return this.successAfterAck(message.messageId, taskRunId, false);
    }

    private async handleFailurePath(
        message: IQueueMessage,
        taskRunId: string,
        error: IDagError
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const failTransition = TaskRunStateMachine.transition('running', 'COMPLETE_FAILURE');
        if (!failTransition.ok) {
            return this.failAfterAck(message.messageId, failTransition.error);
        }

        await this.storage.updateTaskRunStatus(taskRunId, failTransition.value.nextStatus, error);
        this.runProgressEventReporter?.publish({
            dagRunId: message.dagRunId,
            eventType: TASK_PROGRESS_EVENTS.FAILED,
            occurredAt: this.clock.nowIso(),
            taskRunId,
            nodeId: message.nodeId,
            input: message.payload,
            error
        });

        const shouldRetry = this.options.retryEnabled && error.retryable && message.attempt < this.options.maxAttempts;
        if (!shouldRetry) {
            return this.handleTerminalFailure(message, taskRunId, error);
        }

        return this.handleRetry(message, taskRunId);
    }

    private async handleTerminalFailure(
        message: IQueueMessage,
        taskRunId: string,
        error: IDagError
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        if (this.options.deadLetterEnabled) {
            const deadLettered = await this.enqueueDeadLetter(message, error);
            if (!deadLettered.ok) {
                return this.failAfterAck(message.messageId, deadLettered.error);
            }
        }

        const finalized = await finalizeDagRunIfTerminal(
            message.dagRunId, this.storage, this.clock, this.runProgressEventReporter
        );
        if (!finalized.ok) {
            return this.failAfterAck(message.messageId, finalized.error);
        }

        return this.successAfterAck(message.messageId, taskRunId, false);
    }

    private async handleRetry(
        message: IQueueMessage,
        taskRunId: string
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const retryTransition = TaskRunStateMachine.transition('failed', 'RETRY');
        if (!retryTransition.ok) {
            return this.failAfterAck(message.messageId, retryTransition.error);
        }

        await this.storage.incrementTaskAttempt(taskRunId);
        await this.storage.updateTaskRunStatus(taskRunId, retryTransition.value.nextStatus);

        const nextAttempt = message.attempt + 1;
        const nextMessage: IQueueMessage = {
            ...message,
            messageId: `${message.taskRunId}:message:${nextAttempt}`,
            attempt: nextAttempt,
            executionPath: replaceAttemptSegment(message.executionPath, nextAttempt),
            createdAt: this.clock.nowIso()
        };

        try {
            await this.queue.enqueue(nextMessage);
        } catch (error) {
            return this.failAfterAck(
                message.messageId,
                buildDispatchError(
                    'DAG_DISPATCH_ENQUEUE_RETRY_FAILED',
                    'Failed to enqueue retry message',
                    { taskRunId, attempt: nextAttempt, errorMessage: resolveErrorMessage(error) }
                )
            );
        }

        return this.successAfterAck(message.messageId, taskRunId, true);
    }

    private async failAfterAck(messageId: string, error: IDagError): Promise<TResult<IWorkerLoopResult, IDagError>> {
        await this.queue.ack(messageId);
        return { ok: false, error };
    }

    private async successAfterAck(messageId: string, taskRunId: string, retried: boolean): Promise<TResult<IWorkerLoopResult, IDagError>> {
        await this.queue.ack(messageId);
        return { ok: true, value: { processed: true, taskRunId, retried } };
    }

    /**
     * Resolves the timeout for task execution.
     * `timeoutMs` is injected into the message payload by the runtime when dispatching
     * downstream tasks, based on the node definition's `timeoutMs` field.
     * Falls back to `defaultTimeoutMs` from worker options.
     */
    private resolveTimeoutMs(message: IQueueMessage): number {
        const timeoutFromPayload = message.payload.timeoutMs;
        if (typeof timeoutFromPayload === 'number' && timeoutFromPayload > 0) {
            return timeoutFromPayload;
        }
        return this.options.defaultTimeoutMs;
    }

    private async enqueueDeadLetter(
        message: IQueueMessage,
        error: IDagError
    ): Promise<TResult<void, IDagError>> {
        if (!this.options.deadLetterQueue) {
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
            messageId: `${message.taskRunId}:dlq:${this.clock.nowEpochMs()}`,
            payload: {
                ...message.payload,
                dlqReasonCode: error.code,
                dlqReasonMessage: error.message,
                dlqSourceMessageId: message.messageId
            },
            createdAt: this.clock.nowIso()
        };

        try {
            await this.options.deadLetterQueue.enqueue(deadLetterMessage);
            return { ok: true, value: undefined };
        } catch (error) {
            return {
                ok: false,
                error: buildDispatchError(
                    'DAG_DISPATCH_DEAD_LETTER_ENQUEUE_FAILED',
                    'Failed to enqueue dead letter message',
                    {
                        taskRunId: message.taskRunId,
                        originalMessageId: message.messageId,
                        errorMessage: resolveErrorMessage(error)
                    }
                )
            };
        }
    }
}

/** Finds the maximum totalCostUsd across all task runs. */
function resolveCurrentTotalCostUsd(taskRuns: ITaskRun[]): number {
    let currentTotalCostUsd = 0;
    for (const taskRun of taskRuns) {
        if (typeof taskRun.totalCostUsd !== 'number') {
            continue;
        }
        if (taskRun.totalCostUsd > currentTotalCostUsd) {
            currentTotalCostUsd = taskRun.totalCostUsd;
        }
    }
    return currentTotalCostUsd;
}
