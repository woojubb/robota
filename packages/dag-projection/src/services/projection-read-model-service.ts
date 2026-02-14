import {
    buildValidationError,
    type IDagError,
    type IDagRun,
    type IStoragePort,
    type ITaskRun,
    type TTaskRunStatus,
    type TResult
} from '@robota-sdk/dag-core';

export interface ITaskStatusSummary {
    created: number;
    queued: number;
    running: number;
    success: number;
    failed: number;
    upstream_failed: number;
    skipped: number;
    cancelled: number;
}

export interface IRunProjection {
    dagRun: IDagRun;
    taskRuns: ITaskRun[];
    taskStatusSummary: ITaskStatusSummary;
}

export interface ILineageNodeProjection {
    nodeId: string;
    nodeType: string;
    dependsOn: string[];
    taskStatus?: TTaskRunStatus;
}

export interface ILineageEdgeProjection {
    from: string;
    to: string;
}

export interface ILineageProjection {
    dagId: string;
    version: number;
    dagRunId: string;
    nodes: ILineageNodeProjection[];
    edges: ILineageEdgeProjection[];
}

export interface IDashboardProjection {
    runProjection: IRunProjection;
    lineageProjection: ILineageProjection;
}

function createEmptyTaskStatusSummary(): ITaskStatusSummary {
    return {
        created: 0,
        queued: 0,
        running: 0,
        success: 0,
        failed: 0,
        upstream_failed: 0,
        skipped: 0,
        cancelled: 0
    };
}

export class ProjectionReadModelService {
    public constructor(private readonly storage: IStoragePort) {}

    public async buildRunProjection(dagRunId: string): Promise<TResult<IRunProjection, IDagError>> {
        const dagRun = await this.storage.getDagRun(dagRunId);
        if (!dagRun) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
                    'DagRun was not found for projection',
                    { dagRunId }
                )
            };
        }

        const taskRuns = await this.storage.listTaskRunsByDagRunId(dagRunId);
        const taskStatusSummary = createEmptyTaskStatusSummary();
        for (const taskRun of taskRuns) {
            taskStatusSummary[taskRun.status] += 1;
        }

        return {
            ok: true,
            value: {
                dagRun,
                taskRuns,
                taskStatusSummary
            }
        };
    }

    public async buildLineageProjection(dagRunId: string): Promise<TResult<ILineageProjection, IDagError>> {
        const runProjection = await this.buildRunProjection(dagRunId);
        if (!runProjection.ok) {
            return runProjection;
        }

        return this.buildLineageProjectionFromRunProjection(runProjection.value);
    }

    public async buildDashboardProjection(dagRunId: string): Promise<TResult<IDashboardProjection, IDagError>> {
        const runProjection = await this.buildRunProjection(dagRunId);
        if (!runProjection.ok) {
            return runProjection;
        }

        const lineageProjection = await this.buildLineageProjectionFromRunProjection(runProjection.value);
        if (!lineageProjection.ok) {
            return lineageProjection;
        }

        return {
            ok: true,
            value: {
                runProjection: runProjection.value,
                lineageProjection: lineageProjection.value
            }
        };
    }

    private async buildLineageProjectionFromRunProjection(
        runProjection: IRunProjection
    ): Promise<TResult<ILineageProjection, IDagError>> {

        const definition = await this.storage.getDefinition(
            runProjection.dagRun.dagId,
            runProjection.dagRun.version
        );
        if (!definition) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                    'Definition was not found for lineage projection',
                    {
                        dagId: runProjection.dagRun.dagId,
                        version: runProjection.dagRun.version
                    }
                )
            };
        }

        const statusByNodeId = new Map<string, TTaskRunStatus>();
        for (const taskRun of runProjection.taskRuns) {
            statusByNodeId.set(taskRun.nodeId, taskRun.status);
        }

        return {
            ok: true,
            value: {
                dagId: definition.dagId,
                version: definition.version,
                dagRunId: runProjection.dagRun.dagRunId,
                nodes: definition.nodes.map((node) => ({
                    nodeId: node.nodeId,
                    nodeType: node.nodeType,
                    dependsOn: node.dependsOn,
                    taskStatus: statusByNodeId.get(node.nodeId)
                })),
                edges: definition.edges.map((edge) => ({
                    from: edge.from,
                    to: edge.to
                }))
            }
        };
    }
}
