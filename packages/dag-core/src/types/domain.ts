export type TDagDefinitionStatus = 'draft' | 'published' | 'deprecated';

export type TDagRunStatus =
    | 'created'
    | 'queued'
    | 'running'
    | 'success'
    | 'failed'
    | 'cancelled';

export type TTaskRunStatus =
    | 'created'
    | 'queued'
    | 'running'
    | 'success'
    | 'failed'
    | 'upstream_failed'
    | 'skipped'
    | 'cancelled';

export type TDagTriggerType = 'manual' | 'scheduled' | 'api';

export interface IDagNodeDefinition {
    nodeId: string;
    nodeType: string;
    dependsOn: string[];
    triggerPolicy?: string;
    retryPolicy?: string;
    timeoutMs?: number;
    config: Record<string, string | number | boolean | null>;
}

export interface IDagDefinition {
    dagId: string;
    version: number;
    status: TDagDefinitionStatus;
    nodes: IDagNodeDefinition[];
    edges: Array<{
        from: string;
        to: string;
    }>;
    inputSchema?: string;
    outputSchema?: string;
}

export interface IDagRun {
    dagRunId: string;
    dagId: string;
    version: number;
    status: TDagRunStatus;
    runKey: string;
    logicalDate: string;
    trigger: TDagTriggerType;
    startedAt?: string;
    endedAt?: string;
}

export interface ITaskRun {
    taskRunId: string;
    dagRunId: string;
    nodeId: string;
    status: TTaskRunStatus;
    attempt: number;
    leaseOwner?: string;
    leaseUntil?: string;
    inputSnapshot?: string;
    outputSnapshot?: string;
    errorCode?: string;
    errorMessage?: string;
}

export interface IExecutionPathSegment {
    key: 'dagId' | 'dagRunId' | 'nodeId' | 'taskRunId' | 'attempt';
    value: string;
}
