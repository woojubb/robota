export type TDagDefinitionStatus = 'draft' | 'published' | 'deprecated';
export type TPortValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'binary';
export type TBinaryKind = 'image' | 'video' | 'audio' | 'file';

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

export interface IPortDefinition {
    key: string;
    label?: string;
    order?: number;
    type: TPortValueType;
    required: boolean;
    description?: string;
    binaryKind?: TBinaryKind;
    mimeTypes?: string[];
}

export interface INodeManifest {
    nodeType: string;
    displayName: string;
    category: string;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    configSchema?: string;
    deprecated?: boolean;
}

export interface ICostPolicy {
    runCostLimitUsd: number;
    costCurrency: 'USD';
    costPolicyVersion: number;
}

export interface IDagNodeDefinition {
    nodeId: string;
    nodeType: string;
    dependsOn: string[];
    triggerPolicy?: string;
    retryPolicy?: string;
    timeoutMs?: number;
    config: Record<string, string | number | boolean | null>;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    costPolicy?: ICostPolicy;
}

export interface IEdgeBinding {
    outputKey: string;
    inputKey: string;
}

export interface IDagEdgeDefinition {
    from: string;
    to: string;
    bindings?: IEdgeBinding[];
}

export interface IDagDefinition {
    dagId: string;
    version: number;
    status: TDagDefinitionStatus;
    nodes: IDagNodeDefinition[];
    edges: IDagEdgeDefinition[];
    costPolicy?: ICostPolicy;
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
