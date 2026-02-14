import {
    DagRunStateMachine,
    TimeSemanticsService,
    buildDispatchError,
    buildValidationError,
    type IClockPort,
    type IDagError,
    type IQueueMessage,
    type IQueuePort,
    type IStoragePort,
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
        private readonly clock: IClockPort
    ) {
        this.timeSemanticsService = new TimeSemanticsService(clock);
    }

    public async startRun(input: IStartRunInput): Promise<TResult<IStartRunResult, IDagError>> {
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
            const existingTaskRuns = await this.storage.listTaskRunsByDagRunId(existingRun.dagRunId);
            return {
                ok: true,
                value: {
                    dagRunId: existingRun.dagRunId,
                    dagId: existingRun.dagId,
                    version: existingRun.version,
                    logicalDate: existingRun.logicalDate,
                    taskRunIds: existingTaskRuns.map((taskRun) => taskRun.taskRunId)
                }
            };
        }

        const dagRunId = this.generateDagRunId(definition.dagId, resolvedTime.value.logicalDate, input.rerunKey);

        await this.storage.createDagRun({
            dagRunId,
            dagId: definition.dagId,
            version: definition.version,
            status: 'created',
            runKey,
            logicalDate: resolvedTime.value.logicalDate,
            trigger: input.trigger,
            startedAt: this.clock.nowIso()
        });

        const queuedTransition = DagRunStateMachine.transition('created', 'QUEUE');
        if (!queuedTransition.ok) {
            return queuedTransition;
        }
        await this.storage.updateDagRunStatus(dagRunId, queuedTransition.value.nextStatus);

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
                payload: input.input,
                createdAt: this.clock.nowIso()
            };

            try {
                await this.queue.enqueue(message);
            } catch {
                return {
                    ok: false,
                    error: buildDispatchError(
                        'DAG_DISPATCH_ENQUEUE_FAILED',
                        'Failed to enqueue entry task',
                        { dagRunId, taskRunId, nodeId: node.nodeId }
                    )
                };
            }
        }

        const runningTransition = DagRunStateMachine.transition('queued', 'START');
        if (!runningTransition.ok) {
            return runningTransition;
        }
        await this.storage.updateDagRunStatus(dagRunId, runningTransition.value.nextStatus);

        return {
            ok: true,
            value: {
                dagRunId,
                dagId: definition.dagId,
                version: definition.version,
                logicalDate: resolvedTime.value.logicalDate,
                taskRunIds
            }
        };
    }

    private generateDagRunId(dagId: string, logicalDate: string, rerunKey?: string): string {
        const logicalEpochMs = Date.parse(logicalDate);
        return rerunKey
            ? `${dagId}:run:${logicalEpochMs}:rerun:${rerunKey}`
            : `${dagId}:run:${logicalEpochMs}`;
    }
}
