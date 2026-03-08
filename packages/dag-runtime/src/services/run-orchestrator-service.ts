import {
    EXECUTION_PROGRESS_EVENTS,
    DagRunStateMachine,
    TaskRunStateMachine,
    TimeSemanticsService,
    buildDispatchError,
    buildValidationError,
    type IClockPort,
    type IDagDefinition,
    type IDagError,
    type IRunProgressEventReporter,
    type IQueueMessage,
    type IQueuePort,
    type IStoragePort,
    type TDagRunStatus,
    type TDagTriggerType,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';

export interface IStartRunInput {
    dagId: string;
    version?: number;
    trigger: TDagTriggerType;
    logicalDate?: string;
    rerunKey?: string;
    input: TPortPayload;
}

export interface ICreateRunResult {
    dagRunId: string;
    dagId: string;
    version: number;
    logicalDate: string;
    status: TDagRunStatus;
}

export interface IStartRunResult {
    dagRunId: string;
    dagId: string;
    version: number;
    logicalDate: string;
    taskRunIds: string[];
}

export class RunOrchestratorService {
    private readonly timeSemanticsService: TimeSemanticsService;

    public constructor(
        private readonly storage: IStoragePort,
        private readonly queue: IQueuePort,
        private readonly clock: IClockPort,
        private readonly runProgressEventReporter?: IRunProgressEventReporter
    ) {
        this.timeSemanticsService = new TimeSemanticsService(clock);
    }

    public async createRun(input: IStartRunInput): Promise<TResult<ICreateRunResult, IDagError>> {
        const definition = input.version
            ? await this.storage.getDefinition(input.dagId, input.version)
            : await this.storage.getLatestPublishedDefinition(input.dagId);

        if (!definition) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                    'Published DAG definition was not found',
                    { dagId: input.dagId, hasVersion: Boolean(input.version) }
                )
            };
        }

        if (definition.status !== 'published') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_PUBLISHED',
                    'Only published definitions can be executed',
                    { dagId: definition.dagId, version: definition.version, status: definition.status }
                )
            };
        }

        const resolvedTime = this.timeSemanticsService.resolve(input.trigger, input.logicalDate);
        if (!resolvedTime.ok) {
            return resolvedTime;
        }

        const runKey = input.rerunKey
            ? `${definition.dagId}:${resolvedTime.value.logicalDate}:rerun:${input.rerunKey}`
            : `${definition.dagId}:${resolvedTime.value.logicalDate}`;
        const existingRun = await this.storage.getDagRunByRunKey(runKey);
        if (existingRun) {
            return {
                ok: true,
                value: {
                    dagRunId: existingRun.dagRunId,
                    dagId: existingRun.dagId,
                    version: existingRun.version,
                    logicalDate: existingRun.logicalDate,
                    status: existingRun.status
                }
            };
        }

        const dagRunId = this.generateDagRunId(definition.dagId, resolvedTime.value.logicalDate, input.rerunKey);

        try {
            await this.storage.createDagRun({
                dagRunId,
                dagId: definition.dagId,
                version: definition.version,
                status: 'created',
                definitionSnapshot: JSON.stringify(definition),
                inputSnapshot: JSON.stringify(input.input),
                runKey,
                logicalDate: resolvedTime.value.logicalDate,
                trigger: input.trigger,
                startedAt: this.clock.nowIso()
            });
        } catch (error) {
            return {
                ok: false,
                error: buildDispatchError(
                    'DAG_DISPATCH_DAG_RUN_CREATE_FAILED',
                    'Failed to create DagRun',
                    {
                        dagId: definition.dagId,
                        version: definition.version,
                        runKey,
                        errorMessage: this.resolveErrorMessage(error instanceof Error ? error : undefined)
                    }
                )
            };
        }

        return {
            ok: true,
            value: {
                dagRunId,
                dagId: definition.dagId,
                version: definition.version,
                logicalDate: resolvedTime.value.logicalDate,
                status: 'created'
            }
        };
    }

    public async startCreatedRun(dagRunId: string): Promise<TResult<IStartRunResult, IDagError>> {
        const dagRun = await this.storage.getDagRun(dagRunId);
        if (!dagRun) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
                    'DagRun was not found',
                    { dagRunId }
                )
            };
        }
        if (dagRun.status !== 'created') {
            const existingTaskRuns = await this.storage.listTaskRunsByDagRunId(dagRunId);
            return {
                ok: true,
                value: {
                    dagRunId,
                    dagId: dagRun.dagId,
                    version: dagRun.version,
                    logicalDate: dagRun.logicalDate,
                    taskRunIds: existingTaskRuns.map((taskRun) => taskRun.taskRunId)
                }
            };
        }
        if (typeof dagRun.definitionSnapshot !== 'string' || dagRun.definitionSnapshot.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING',
                    'DagRun definition snapshot is missing',
                    { dagRunId }
                )
            };
        }
        const parsedDefinition = this.parseDefinitionSnapshot(dagRun.definitionSnapshot);
        if (!parsedDefinition.ok) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
                    'DagRun definition snapshot is invalid',
                    { dagRunId }
                )
            };
        }
        const definition = parsedDefinition.value;
        const parsedInput = this.parsePortPayload(dagRun.inputSnapshot ?? '{}');
        if (!parsedInput.ok) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_RUN_INPUT_SNAPSHOT_INVALID',
                    'DagRun input snapshot is invalid',
                    { dagRunId }
                )
            };
        }
        const input = parsedInput.value;
        const entryNodes = definition.nodes.filter((node) => node.dependsOn.length === 0);
        if (entryNodes.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NO_ENTRY_NODE',
                    'DAG must include at least one entry node (dependsOn = [])',
                    { dagId: definition.dagId, version: definition.version }
                )
            };
        }

        const queuedTransition = DagRunStateMachine.transition('created', 'QUEUE');
        if (!queuedTransition.ok) {
            return queuedTransition;
        }
        await this.storage.updateDagRunStatus(dagRunId, queuedTransition.value.nextStatus);
        const runningTransition = DagRunStateMachine.transition('queued', 'START');
        if (!runningTransition.ok) {
            return runningTransition;
        }
        await this.storage.updateDagRunStatus(dagRunId, runningTransition.value.nextStatus);
        this.runProgressEventReporter?.publish({
            dagRunId,
            eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
            occurredAt: this.clock.nowIso(),
            dagId: definition.dagId,
            version: definition.version
        });

        const taskRunIds: string[] = [];
        for (const node of entryNodes) {
            const taskRunId = `${dagRunId}:${node.nodeId}:attempt:1`;
            taskRunIds.push(taskRunId);

            await this.storage.createTaskRun({
                taskRunId,
                dagRunId,
                nodeId: node.nodeId,
                status: 'queued',
                attempt: 1
            });

            const message: IQueueMessage = {
                messageId: `${taskRunId}:message`,
                dagRunId,
                taskRunId,
                nodeId: node.nodeId,
                attempt: 1,
                executionPath: [
                    `dagId:${definition.dagId}`,
                    `dagRunId:${dagRunId}`,
                    `nodeId:${node.nodeId}`,
                    `taskRunId:${taskRunId}`,
                    'attempt:1'
                ],
                payload: input,
                createdAt: this.clock.nowIso()
            };

            try {
                await this.queue.enqueue(message);
            } catch (error) {
                const dispatchError = buildDispatchError(
                    'DAG_DISPATCH_ENQUEUE_FAILED',
                    'Failed to enqueue entry task',
                    {
                        dagRunId,
                        taskRunId,
                        nodeId: node.nodeId,
                        errorMessage: this.resolveErrorMessage(error instanceof Error ? error : undefined)
                    }
                );
                const cancelledTaskTransition = TaskRunStateMachine.transition('queued', 'CANCEL');
                if (cancelledTaskTransition.ok) {
                    // Cancel the current failed task
                    await this.storage.updateTaskRunStatus(taskRunId, cancelledTaskTransition.value.nextStatus, dispatchError);
                    // Cancel previously-enqueued tasks in this batch to prevent orphans
                    for (const previousTaskRunId of taskRunIds) {
                        if (previousTaskRunId === taskRunId) {
                            continue;
                        }
                        await this.storage.updateTaskRunStatus(previousTaskRunId, cancelledTaskTransition.value.nextStatus, dispatchError);
                    }
                }
                const failedRunTransition = DagRunStateMachine.transition('running', 'COMPLETE_FAILURE');
                if (failedRunTransition.ok) {
                    await this.storage.updateDagRunStatus(
                        dagRunId,
                        failedRunTransition.value.nextStatus,
                        this.clock.nowIso()
                    );
                    this.runProgressEventReporter?.publish({
                        dagRunId,
                        eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
                        occurredAt: this.clock.nowIso(),
                        error: dispatchError
                    });
                }
                return {
                    ok: false,
                    error: dispatchError
                };
            }
        }

        return {
            ok: true,
            value: {
                dagRunId,
                dagId: dagRun.dagId,
                version: dagRun.version,
                logicalDate: dagRun.logicalDate,
                taskRunIds
            }
        };
    }

    public async startRun(input: IStartRunInput): Promise<TResult<IStartRunResult, IDagError>> {
        const created = await this.createRun(input);
        if (!created.ok) {
            return created;
        }
        if (created.value.status === 'created') {
            return this.startCreatedRun(created.value.dagRunId);
        }
        const existingTaskRuns = await this.storage.listTaskRunsByDagRunId(created.value.dagRunId);
        return {
            ok: true,
            value: {
                dagRunId: created.value.dagRunId,
                dagId: created.value.dagId,
                version: created.value.version,
                logicalDate: created.value.logicalDate,
                taskRunIds: existingTaskRuns.map((taskRun) => taskRun.taskRunId)
            }
        };
    }

    private parsePortPayload(input: string): TResult<TPortPayload, IDagError> {
        try {
            const parsed = JSON.parse(input);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_PAYLOAD_INVALID',
                        'Payload must be a JSON object'
                    )
                };
            }
            return {
                ok: true,
                value: parsed
            };
        } catch {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_PAYLOAD_PARSE_FAILED',
                    'Failed to parse payload JSON'
                )
            };
        }
    }

    private parseDefinitionSnapshot(input: string): TResult<IDagDefinition, IDagError> {
        try {
            const parsed = JSON.parse(input);
            if (
                typeof parsed !== 'object'
                || parsed === null
                || Array.isArray(parsed)
                || !('dagId' in parsed)
                || !('version' in parsed)
                || !('nodes' in parsed)
                || !('edges' in parsed)
                || !('status' in parsed)
                || typeof parsed.dagId !== 'string'
                || typeof parsed.version !== 'number'
                || !Array.isArray(parsed.nodes)
                || !Array.isArray(parsed.edges)
                || typeof parsed.status !== 'string'
            ) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
                        'Definition snapshot must be a valid DAG definition object'
                    )
                };
            }
            return {
                ok: true,
                value: parsed as IDagDefinition
            };
        } catch {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED',
                    'Failed to parse definition snapshot JSON'
                )
            };
        }
    }

    private generateDagRunId(dagId: string, logicalDate: string, rerunKey?: string): string {
        const logicalEpochMs = Date.parse(logicalDate);
        return rerunKey
            ? `${dagId}:run:${logicalEpochMs}:rerun:${rerunKey}`
            : `${dagId}:run:${logicalEpochMs}`;
    }

    private resolveErrorMessage(error: Error | undefined): string {
        if (error instanceof Error && error.message.trim().length > 0) {
            return error.message;
        }
        return 'Unknown error';
    }
}
