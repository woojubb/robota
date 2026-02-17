import {
    DagDefinitionService,
    buildValidationError,
    type IClockPort,
    type IDagDefinition,
    type IDagError,
    type IDagRun,
    type IStoragePort,
    type ITaskRun,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import type { IDagExecutionComposition } from '@robota-sdk/dag-api';

export interface IRunNodeTrace {
    nodeId: string;
    nodeType: string;
    input: TPortPayload;
    output: TPortPayload;
    estimatedCostUsd: number;
    totalCostUsd: number;
}

export interface IRunResult {
    dagRunId: string;
    traces: IRunNodeTrace[];
    totalCostUsd: number;
}

export interface IDagRunServiceOptions {
    storage: IStoragePort;
    execution: IDagExecutionComposition;
    clock: IClockPort;
}

export class DagRunService {
    private readonly definitionService: DagDefinitionService;
    private readonly execution: IDagExecutionComposition;
    private readonly storage: IStoragePort;
    private readonly clock: IClockPort;

    constructor(options: IDagRunServiceOptions) {
        this.storage = options.storage;
        this.execution = options.execution;
        this.clock = options.clock;
        this.definitionService = new DagDefinitionService(options.storage);
    }

    public async createRun(
        definition: IDagDefinition,
        input: TPortPayload
    ): Promise<TResult<{ dagRunId: string }, IDagError>> {
        const copiedDefinition = this.createRunDefinitionCopy(definition);
        const createdDraft = await this.definitionService.createDraft(copiedDefinition);
        if (!createdDraft.ok) {
            return {
                ok: false,
                error: createdDraft.error[0]
            };
        }
        const publishedResult = await this.definitionService.publish(copiedDefinition.dagId, copiedDefinition.version);
        if (!publishedResult.ok) {
            return {
                ok: false,
                error: publishedResult.error[0]
            };
        }

        const createdRun = await this.execution.runOrchestrator.createRun({
            dagId: publishedResult.value.dagId,
            version: publishedResult.value.version,
            trigger: 'manual',
            input
        });
        if (!createdRun.ok) {
            return {
                ok: false,
                error: createdRun.error
            };
        }
        return {
            ok: true,
            value: {
                dagRunId: createdRun.value.dagRunId
            }
        };
    }

    public async startRunById(dagRunId: string): Promise<TResult<{ dagRunId: string }, IDagError>> {
        const started = await this.execution.runOrchestrator.startCreatedRun(dagRunId);
        if (!started.ok) {
            return {
                ok: false,
                error: started.error
            };
        }
        void this.processRunUntilTerminal(dagRunId);
        return {
            ok: true,
            value: { dagRunId }
        };
    }

    public async getRunResult(dagRunId: string): Promise<TResult<IRunResult, IDagError>> {
        const queryResult = await this.execution.runQuery.getRun(dagRunId);
        if (!queryResult.ok) {
            return queryResult;
        }
        const dagRunStatus = queryResult.value.dagRun.status;
        const isTerminal = dagRunStatus === 'success' || dagRunStatus === 'failed' || dagRunStatus === 'cancelled';
        if (!isTerminal) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_RUN_NOT_TERMINAL',
                    'Run is not in a terminal state yet',
                    {
                        dagRunId,
                        status: dagRunStatus
                    }
                )
            };
        }
        if (dagRunStatus !== 'success') {
            return this.buildFailedRunError(queryResult.value);
        }
        return this.mapRunQueryToRunResult(queryResult.value);
    }

    public async deleteRunArtifacts(dagRunId: string): Promise<TResult<{ deletedTaskRunCount: number }, IDagError>> {
        const existingRun = await this.storage.getDagRun(dagRunId);
        if (!existingRun) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
                    'DagRun was not found for deletion',
                    { dagRunId }
                )
            };
        }
        const taskRuns = await this.storage.listTaskRunsByDagRunId(dagRunId);
        await this.storage.deleteTaskRunsByDagRunId(dagRunId);
        await this.storage.deleteDagRun(dagRunId);
        return {
            ok: true,
            value: {
                deletedTaskRunCount: taskRuns.length
            }
        };
    }

    public async deleteDefinitionArtifacts(
        dagId: string,
        version?: number
    ): Promise<TResult<{
        deletedDefinitionCount: number;
        deletedDagRunCount: number;
        deletedTaskRunCount: number;
    }, IDagError>> {
        const definitions = await this.storage.listDefinitionsByDagId(dagId);
        const targetDefinitions = typeof version === 'number'
            ? definitions.filter((definition) => definition.version === version)
            : definitions;
        if (targetDefinitions.length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                    'Definition was not found for deletion',
                    { dagId, version: typeof version === 'number' ? version : 'all' }
                )
            };
        }

        return this.deleteArtifactsForDefinitions(targetDefinitions);
    }

    public async deleteRunCopyArtifacts(): Promise<TResult<{
        deletedDefinitionCount: number;
        deletedDagRunCount: number;
        deletedTaskRunCount: number;
    }, IDagError>> {
        const definitions = await this.storage.listDefinitions();
        const runCopyDefinitions = definitions.filter((definition) => definition.dagId.startsWith('run-copy:'));
        if (runCopyDefinitions.length === 0) {
            return {
                ok: true,
                value: {
                    deletedDefinitionCount: 0,
                    deletedDagRunCount: 0,
                    deletedTaskRunCount: 0
                }
            };
        }
        return this.deleteArtifactsForDefinitions(runCopyDefinitions);
    }

    private createRunDefinitionCopy(definition: IDagDefinition): IDagDefinition {
        const timestamp = this.clock.nowEpochMs();
        const randomSuffix = Math.floor(Math.random() * 10000);
        return {
            ...definition,
            dagId: `run-copy:${definition.dagId}:${timestamp}:${randomSuffix}`,
            version: 1,
            status: 'draft'
        };
    }

    private async processRunUntilTerminal(dagRunId: string): Promise<void> {
        let iteration = 0;
        while (iteration < 5000) {
            const queried = await this.execution.runQuery.getRun(dagRunId);
            if (!queried.ok) {
                return;
            }
            const dagRunStatus = queried.value.dagRun.status;
            const isTerminal = dagRunStatus === 'success' || dagRunStatus === 'failed' || dagRunStatus === 'cancelled';
            if (isTerminal) {
                return;
            }
            const processed = await this.execution.workerLoop.processOnce();
            if (!processed.ok || !processed.value.processed) {
                return;
            }
            iteration += 1;
        }
    }

    private mapRunQueryToRunResult(
        query: { dagRun: IDagRun; taskRuns: ITaskRun[] }
    ): TResult<IRunResult, IDagError> {
        const definitionResult = this.parseDefinitionSnapshot(query.dagRun);
        if (!definitionResult.ok) {
            return definitionResult;
        }
        const definition = definitionResult.value;
        const nodeTypeByNodeId = new Map(definition.nodes.map((node) => [node.nodeId, node.nodeType]));
        const nodeOrderByNodeId = new Map(definition.nodes.map((node, index) => [node.nodeId, index]));
        const successfulTaskRuns = query.taskRuns
            .filter((taskRun) => taskRun.status === 'success')
            .sort((a, b) => {
                const orderA = nodeOrderByNodeId.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER;
                const orderB = nodeOrderByNodeId.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER;
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                return a.taskRunId.localeCompare(b.taskRunId);
            });

        const traces: IRunNodeTrace[] = [];
        let maxTotalCostUsd = 0;
        for (const taskRun of successfulTaskRuns) {
            const nodeType = nodeTypeByNodeId.get(taskRun.nodeId);
            if (!nodeType) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_RUN_TRACE_NODE_TYPE_NOT_FOUND',
                        'Node type was not found while mapping run traces',
                        { nodeId: taskRun.nodeId, dagRunId: query.dagRun.dagRunId }
                    )
                };
            }
            if (typeof taskRun.inputSnapshot !== 'string' || typeof taskRun.outputSnapshot !== 'string') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_RUN_TRACE_SNAPSHOT_MISSING',
                        'TaskRun snapshots are required to build run traces',
                        { taskRunId: taskRun.taskRunId }
                    )
                };
            }
            const parsedInput = this.parsePortPayload(taskRun.inputSnapshot, taskRun.taskRunId, 'input');
            if (!parsedInput.ok) {
                return parsedInput;
            }
            const parsedOutput = this.parsePortPayload(taskRun.outputSnapshot, taskRun.taskRunId, 'output');
            if (!parsedOutput.ok) {
                return parsedOutput;
            }
            if (typeof taskRun.estimatedCostUsd !== 'number' || typeof taskRun.totalCostUsd !== 'number') {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_RUN_TRACE_COST_MISSING',
                        'TaskRun cost fields are required to build run traces',
                        { taskRunId: taskRun.taskRunId }
                    )
                };
            }
            traces.push({
                nodeId: taskRun.nodeId,
                nodeType,
                input: parsedInput.value,
                output: parsedOutput.value,
                estimatedCostUsd: taskRun.estimatedCostUsd,
                totalCostUsd: taskRun.totalCostUsd
            });
            if (taskRun.totalCostUsd > maxTotalCostUsd) {
                maxTotalCostUsd = taskRun.totalCostUsd;
            }
        }

        return {
            ok: true,
            value: {
                dagRunId: query.dagRun.dagRunId,
                traces,
                totalCostUsd: maxTotalCostUsd
            }
        };
    }

    private parseDefinitionSnapshot(dagRun: IDagRun): TResult<IDagDefinition, IDagError> {
        if (typeof dagRun.definitionSnapshot !== 'string' || dagRun.definitionSnapshot.trim().length === 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING',
                    'DagRun definition snapshot is missing',
                    { dagRunId: dagRun.dagRunId }
                )
            };
        }
        try {
            const parsed = JSON.parse(dagRun.definitionSnapshot);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
                        'DagRun definition snapshot has invalid shape',
                        { dagRunId: dagRun.dagRunId }
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
                    'Failed to parse DagRun definition snapshot',
                    { dagRunId: dagRun.dagRunId }
                )
            };
        }
    }

    private parsePortPayload(
        snapshotText: string,
        taskRunId: string,
        snapshotType: 'input' | 'output'
    ): TResult<TPortPayload, IDagError> {
        try {
            const parsed = JSON.parse(snapshotText);
            if (!this.isPortPayload(parsed)) {
                return {
                    ok: false,
                    error: buildValidationError(
                        'DAG_VALIDATION_RUN_TRACE_SNAPSHOT_INVALID',
                        `${snapshotType} snapshot has invalid payload shape`,
                        { taskRunId, snapshotType }
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
                    'DAG_VALIDATION_RUN_TRACE_SNAPSHOT_PARSE_FAILED',
                    `Failed to parse ${snapshotType} snapshot`,
                    { taskRunId, snapshotType }
                )
            };
        }
    }

    private isPortPayload(input: unknown): input is TPortPayload {
        return typeof input === 'object' && input !== null && !Array.isArray(input);
    }

    private buildFailedRunError(query: { dagRun: IDagRun; taskRuns: ITaskRun[] }): TResult<never, IDagError> {
        const failedTaskRun = query.taskRuns.find((taskRun) =>
            taskRun.status === 'failed'
            || taskRun.status === 'upstream_failed'
            || taskRun.status === 'cancelled'
        );
        if (!failedTaskRun) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_RUN_FAILED_WITHOUT_TASK',
                    'Run finished with failure status but no failed task run was found',
                    { dagRunId: query.dagRun.dagRunId, dagRunStatus: query.dagRun.status }
                )
            };
        }
        if (typeof failedTaskRun.errorCode !== 'string' || typeof failedTaskRun.errorMessage !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_RUN_FAILURE_DETAILS_MISSING',
                    'Failed task run is missing error details',
                    { dagRunId: query.dagRun.dagRunId, taskRunId: failedTaskRun.taskRunId }
                )
            };
        }
        return {
            ok: false,
            error: buildValidationError(
                failedTaskRun.errorCode,
                failedTaskRun.errorMessage,
                {
                    dagRunId: query.dagRun.dagRunId,
                    taskRunId: failedTaskRun.taskRunId,
                    nodeId: failedTaskRun.nodeId
                }
            )
        };
    }

    private async deleteArtifactsForDefinitions(targetDefinitions: IDagDefinition[]): Promise<TResult<{
        deletedDefinitionCount: number;
        deletedDagRunCount: number;
        deletedTaskRunCount: number;
    }, IDagError>> {
        const allDagRuns = await this.storage.listDagRuns();
        const targetRuns = allDagRuns.filter((dagRun) =>
            targetDefinitions.some((definition) =>
                definition.dagId === dagRun.dagId && definition.version === dagRun.version
            )
        );

        let deletedTaskRunCount = 0;
        for (const dagRun of targetRuns) {
            const taskRuns = await this.storage.listTaskRunsByDagRunId(dagRun.dagRunId);
            deletedTaskRunCount += taskRuns.length;
            await this.storage.deleteTaskRunsByDagRunId(dagRun.dagRunId);
            await this.storage.deleteDagRun(dagRun.dagRunId);
        }

        for (const definition of targetDefinitions) {
            await this.storage.deleteDefinition(definition.dagId, definition.version);
        }

        return {
            ok: true,
            value: {
                deletedDefinitionCount: targetDefinitions.length,
                deletedDagRunCount: targetRuns.length,
                deletedTaskRunCount
            }
        };
    }
}
