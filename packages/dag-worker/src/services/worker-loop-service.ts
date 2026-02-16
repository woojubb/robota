import {
    DagRunStateMachine,
    TaskRunStateMachine,
    buildDispatchError,
    buildLeaseError,
    buildTaskExecutionError,
    buildValidationError,
    type IClockPort,
    type IDagRun,
    type IDagError,
    type ILeasePort,
    type IQueueMessage,
    type IQueuePort,
    type ITaskRun,
    type IStoragePort,
    type ITaskExecutionInput,
    type ITaskExecutorPort,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { replaceAttemptSegment } from '../utils/execution-path.js';

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

export interface IWorkerLoopResult {
    processed: boolean;
    taskRunId?: string;
    retried?: boolean;
}

function buildTimeoutError(
    taskRunId: string,
    timeoutMs: number
): IDagError {
    return buildTaskExecutionError(
        'DAG_TASK_EXECUTION_TIMEOUT',
        `Task execution timed out after ${timeoutMs}ms`,
        true,
        {
            taskRunId,
            timeoutMs
        }
    );
}

export class WorkerLoopService {
    public constructor(
        private readonly storage: IStoragePort,
        private readonly queue: IQueuePort,
        private readonly lease: ILeasePort,
        private readonly executor: ITaskExecutorPort,
        private readonly clock: IClockPort,
        private readonly options: IWorkerLoopOptions
    ) {}

    public async processOnce(): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const message = await this.queue.dequeue(this.options.workerId, this.options.visibilityTimeoutMs);
        if (!message) {
            return {
                ok: true,
                value: {
                    processed: false
                }
            };
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
                buildValidationError(
                    'DAG_VALIDATION_TASK_RUN_NOT_FOUND',
                    'TaskRun not found for dequeued message',
                    { taskRunId: message.taskRunId }
                )
            );
        }

        const startTransition = TaskRunStateMachine.transition(taskRun.status, 'START');
        if (!startTransition.ok) {
            return this.failAfterAck(message.messageId, startTransition.error);
        }
        await this.storage.updateTaskRunStatus(taskRun.taskRunId, startTransition.value.nextStatus);
        await this.storage.saveTaskRunSnapshots(taskRun.taskRunId, JSON.stringify(message.payload));

        const dagRun = await this.storage.getDagRun(message.dagRunId);
        if (!dagRun) {
            return this.failAfterAck(
                message.messageId,
                buildValidationError(
                    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
                    'DagRun not found for dequeued message',
                    { dagRunId: message.dagRunId }
                )
            );
        }

        const definition = await this.storage.getDefinition(dagRun.dagId, dagRun.version);
        if (!definition) {
            return this.failAfterAck(
                message.messageId,
                buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                    'Definition not found for task execution',
                    { dagId: dagRun.dagId, version: dagRun.version }
                )
            );
        }

        const nodeDefinition = definition.nodes.find((node) => node.nodeId === message.nodeId);
        if (!nodeDefinition) {
            return this.failAfterAck(
                message.messageId,
                buildValidationError(
                    'DAG_VALIDATION_NODE_NOT_FOUND',
                    'Node definition not found for task execution',
                    { nodeId: message.nodeId, dagId: dagRun.dagId, version: dagRun.version }
                )
            );
        }

        const executionInput: ITaskExecutionInput = {
            dagId: dagRun.dagId,
            dagRunId: message.dagRunId,
            taskRunId: message.taskRunId,
            nodeId: message.nodeId,
            attempt: message.attempt,
            executionPath: message.executionPath,
            input: message.payload,
            nodeDefinition,
            costPolicy: definition.costPolicy,
            currentTotalCostUsd: 0
        };

        const timeoutMs = this.resolveTimeoutMs(message);
        const executionResult = await this.executeWithTimeout(executionInput, timeoutMs, message.taskRunId);

        if (executionResult.ok) {
            return this.handleSuccessPath(message, taskRun.taskRunId, dagRun, executionResult.output);
        }

        return this.handleFailurePath(message, taskRun.taskRunId, executionResult.error);
    }

    private async handleSuccessPath(
        message: IQueueMessage,
        taskRunId: string,
        dagRun: IDagRun,
        output: TPortPayload
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        const completeTransition = TaskRunStateMachine.transition('running', 'COMPLETE_SUCCESS');
        if (!completeTransition.ok) {
            return this.failAfterAck(message.messageId, completeTransition.error);
        }

        await this.storage.updateTaskRunStatus(taskRunId, completeTransition.value.nextStatus);
        await this.storage.saveTaskRunSnapshots(taskRunId, undefined, JSON.stringify(output));

        const dispatched = await this.dispatchDownstreamReadyTasks(dagRun, message.nodeId, output);
        if (!dispatched.ok) {
            return this.failAfterAck(message.messageId, dispatched.error);
        }

        const finalized = await this.finalizeDagRunIfTerminal(message.dagRunId);
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

        const shouldRetry = this.options.retryEnabled && error.retryable && message.attempt < this.options.maxAttempts;
        if (!shouldRetry) {
            if (this.options.deadLetterEnabled) {
                const deadLettered = await this.enqueueDeadLetter(message, error);
                if (!deadLettered.ok) {
                    return this.failAfterAck(message.messageId, deadLettered.error);
                }
            }

            const finalized = await this.finalizeDagRunIfTerminal(message.dagRunId);
            if (!finalized.ok) {
                return this.failAfterAck(message.messageId, finalized.error);
            }

            return this.successAfterAck(message.messageId, taskRunId, false);
        }

        const retryTransition = TaskRunStateMachine.transition('failed', 'RETRY');
        if (!retryTransition.ok) {
            return this.failAfterAck(message.messageId, retryTransition.error);
        }

        await this.storage.incrementTaskAttempt(taskRunId);
        await this.storage.updateTaskRunStatus(taskRunId, retryTransition.value.nextStatus);

        const nextMessage: IQueueMessage = {
            ...message,
            messageId: `${message.taskRunId}:message:${message.attempt + 1}`,
            attempt: message.attempt + 1,
            executionPath: replaceAttemptSegment(message.executionPath, message.attempt + 1),
            createdAt: this.clock.nowIso()
        };

        try {
            await this.queue.enqueue(nextMessage);
        } catch {
            return this.failAfterAck(
                message.messageId,
                buildDispatchError(
                    'DAG_DISPATCH_ENQUEUE_RETRY_FAILED',
                    'Failed to enqueue retry message',
                    { taskRunId, attempt: nextMessage.attempt }
                )
            );
        }

        return this.successAfterAck(message.messageId, taskRunId, true);
    }

    private async failAfterAck(
        messageId: string,
        error: IDagError
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        await this.queue.ack(messageId);
        return {
            ok: false,
            error
        };
    }

    private async successAfterAck(
        messageId: string,
        taskRunId: string,
        retried: boolean
    ): Promise<TResult<IWorkerLoopResult, IDagError>> {
        await this.queue.ack(messageId);
        return {
            ok: true,
            value: {
                processed: true,
                taskRunId,
                retried
            }
        };
    }

    private resolveTimeoutMs(message: IQueueMessage): number {
        const timeoutFromPayload = message.payload.timeoutMs;
        if (typeof timeoutFromPayload === 'number' && timeoutFromPayload > 0) {
            return timeoutFromPayload;
        }

        return this.options.defaultTimeoutMs;
    }

    private async executeWithTimeout(
        input: ITaskExecutionInput,
        timeoutMs: number,
        taskRunId: string
    ): Promise<Awaited<ReturnType<ITaskExecutorPort['execute']>>> {
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

            this.executor.execute(input)
                .then((result) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(() => {
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
                            { taskRunId }
                        )
                    });
                });
        });
    }

    private async dispatchDownstreamReadyTasks(
        dagRun: IDagRun,
        completedNodeId: string,
        _output: TPortPayload
    ): Promise<TResult<void, IDagError>> {
        const definition = await this.storage.getDefinition(dagRun.dagId, dagRun.version);
        if (!definition) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                    'Definition not found for downstream dispatch',
                    {
                        dagId: dagRun.dagId,
                        version: dagRun.version
                    }
                )
            };
        }

        const downstreamNodes = definition.nodes.filter((node) => node.dependsOn.includes(completedNodeId));
        if (downstreamNodes.length === 0) {
            return {
                ok: true,
                value: undefined
            };
        }

        const allTaskRuns = await this.storage.listTaskRunsByDagRunId(dagRun.dagRunId);
        for (const downstreamNode of downstreamNodes) {
            const alreadyCreated = allTaskRuns.some((taskRun) => taskRun.nodeId === downstreamNode.nodeId);
            if (alreadyCreated) {
                continue;
            }

            const ready = downstreamNode.dependsOn.every((upstreamNodeId) =>
                allTaskRuns.some((taskRun) => taskRun.nodeId === upstreamNodeId && taskRun.status === 'success')
            );
            if (!ready) {
                continue;
            }

            const nextTaskRunId = `${dagRun.dagRunId}:${downstreamNode.nodeId}:attempt:1`;
            await this.storage.createTaskRun({
                taskRunId: nextTaskRunId,
                dagRunId: dagRun.dagRunId,
                nodeId: downstreamNode.nodeId,
                status: 'queued',
                attempt: 1
            });

            const nextPayloadResult = this.buildDownstreamPayload(definition, allTaskRuns, downstreamNode.nodeId);
            if (!nextPayloadResult.ok) {
                return nextPayloadResult;
            }
            const nextPayload: TPortPayload = downstreamNode.timeoutMs
                ? {
                    ...nextPayloadResult.value,
                    timeoutMs: downstreamNode.timeoutMs
                }
                : nextPayloadResult.value;

            const nextMessage: IQueueMessage = {
                messageId: `${nextTaskRunId}:message:1`,
                dagRunId: dagRun.dagRunId,
                taskRunId: nextTaskRunId,
                nodeId: downstreamNode.nodeId,
                attempt: 1,
                executionPath: [
                    `dagId:${dagRun.dagId}`,
                    `dagRunId:${dagRun.dagRunId}`,
                    `nodeId:${downstreamNode.nodeId}`,
                    `taskRunId:${nextTaskRunId}`,
                    'attempt:1'
                ],
                payload: nextPayload,
                createdAt: this.clock.nowIso()
            };

            try {
                await this.queue.enqueue(nextMessage);
            } catch {
                return {
                    ok: false,
                    error: buildDispatchError(
                        'DAG_DISPATCH_ENQUEUE_DOWNSTREAM_FAILED',
                        'Failed to enqueue downstream task',
                        {
                            dagRunId: dagRun.dagRunId,
                            nodeId: downstreamNode.nodeId
                        }
                    )
                };
            }

            allTaskRuns.push({
                taskRunId: nextTaskRunId,
                dagRunId: dagRun.dagRunId,
                nodeId: downstreamNode.nodeId,
                status: 'queued',
                attempt: 1
            });
        }

        return {
            ok: true,
            value: undefined
        };
    }

    private buildDownstreamPayload(
        definition: NonNullable<Awaited<ReturnType<IStoragePort['getDefinition']>>>,
        taskRuns: ITaskRun[],
        downstreamNodeId: string
    ): TResult<TPortPayload, IDagError> {
        const incomingEdges = definition.edges.filter((edge) => edge.to === downstreamNodeId);
        if (incomingEdges.length === 0) {
            return {
                ok: true,
                value: {}
            };
        }

        const payload: TPortPayload = {};
        for (const edge of incomingEdges) {
            if (!edge.bindings || edge.bindings.length === 0) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_BINDING_REQUIRED',
                        'Incoming edge must define at least one binding',
                        { from: edge.from, to: edge.to }
                    )
                };
            }

            const upstreamTask = taskRuns.find((taskRun) => taskRun.nodeId === edge.from && taskRun.status === 'success');
            if (!upstreamTask || !upstreamTask.outputSnapshot) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_UPSTREAM_OUTPUT_MISSING',
                        'Upstream output snapshot is missing for binding dispatch',
                        { from: edge.from, to: edge.to }
                    )
                };
            }

            let upstreamOutput: TPortPayload;
            try {
                const parsed = JSON.parse(upstreamTask.outputSnapshot);
                if (!this.isPortPayload(parsed)) {
                    return {
                        ok: false,
                        error: buildValidationError(
                            'DAG_VALIDATION_UPSTREAM_OUTPUT_INVALID',
                            'Upstream output snapshot has invalid payload shape',
                            { from: edge.from, to: edge.to }
                        )
                    };
                }
                upstreamOutput = parsed;
            } catch {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_UPSTREAM_OUTPUT_PARSE_FAILED',
                        'Failed to parse upstream output snapshot',
                        { from: edge.from, to: edge.to }
                    )
                };
            }

            for (const binding of edge.bindings) {
                const outputValue = upstreamOutput[binding.outputKey];
                if (typeof outputValue === 'undefined') {
                    return {
                        ok: false,
                        error: buildValidationError(
                            'DAG_VALIDATION_BINDING_OUTPUT_KEY_MISSING',
                            'Binding outputKey was not found in upstream output',
                            { from: edge.from, outputKey: binding.outputKey }
                        )
                    };
                }

                if (typeof payload[binding.inputKey] !== 'undefined') {
                    return {
                        ok: false,
                        error: buildValidationError(
                            'DAG_VALIDATION_BINDING_INPUT_KEY_CONFLICT',
                            'Multiple bindings target the same input key',
                            { to: edge.to, inputKey: binding.inputKey }
                        )
                    };
                }
                payload[binding.inputKey] = outputValue;
            }
        }

        return {
            ok: true,
            value: payload
        };
    }

    private isPortPayload(input: unknown): input is TPortPayload {
        return typeof input === 'object' && input !== null && !Array.isArray(input);
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
            return {
                ok: true,
                value: undefined
            };
        } catch {
            return {
                ok: false,
                error: buildDispatchError(
                    'DAG_DISPATCH_DEAD_LETTER_ENQUEUE_FAILED',
                    'Failed to enqueue dead letter message',
                    {
                        taskRunId: message.taskRunId,
                        originalMessageId: message.messageId
                    }
                )
            };
        }
    }

    private async finalizeDagRunIfTerminal(dagRunId: string): Promise<TResult<void, IDagError>> {
        const dagRun = await this.storage.getDagRun(dagRunId);
        if (!dagRun) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
                    'DagRun not found while finalizing run status',
                    { dagRunId }
                )
            };
        }

        if (dagRun.status !== 'running') {
            return {
                ok: true,
                value: undefined
            };
        }

        const taskRuns = await this.storage.listTaskRunsByDagRunId(dagRunId);
        const hasPendingTask = taskRuns.some((taskRun) =>
            taskRun.status === 'created' || taskRun.status === 'queued' || taskRun.status === 'running'
        );
        if (hasPendingTask) {
            return {
                ok: true,
                value: undefined
            };
        }

        const hasFailure = taskRuns.some((taskRun) =>
            taskRun.status === 'failed'
            || taskRun.status === 'upstream_failed'
            || taskRun.status === 'cancelled'
        );
        const transition = DagRunStateMachine.transition(
            dagRun.status,
            hasFailure ? 'COMPLETE_FAILURE' : 'COMPLETE_SUCCESS'
        );
        if (!transition.ok) {
            return transition;
        }

        await this.storage.updateDagRunStatus(
            dagRunId,
            transition.value.nextStatus,
            this.clock.nowIso()
        );
        return {
            ok: true,
            value: undefined
        };
    }
}
