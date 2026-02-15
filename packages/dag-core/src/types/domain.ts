export type TDagDefinitionStatus = 'draft' | 'published' | 'deprecated';
export type TPortValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'binary';
export type TBinaryKind = 'image' | 'video' | 'audio' | 'file';
export type TNodeConfigValue = string | number | boolean | null;
export type TNodeConfigRecord = Record<string, TNodeConfigValue>;

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

export interface IBinaryPortPreset {
    binaryKind: TBinaryKind;
    mimeTypes: readonly string[];
}

export const BINARY_PORT_PRESETS = {
    IMAGE_PNG: { binaryKind: 'image', mimeTypes: ['image/png'] },
    IMAGE_COMMON: { binaryKind: 'image', mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    VIDEO_MP4: { binaryKind: 'video', mimeTypes: ['video/mp4'] },
    AUDIO_MPEG: { binaryKind: 'audio', mimeTypes: ['audio/mpeg'] },
    FILE_GENERIC: { binaryKind: 'file', mimeTypes: [] }
} as const;

export interface IBinaryPortDefinitionInput {
    key: string;
    label?: string;
    order?: number;
    required: boolean;
    description?: string;
    preset: IBinaryPortPreset;
}

export function createBinaryPortDefinition(input: IBinaryPortDefinitionInput): IPortDefinition {
    return {
        key: input.key,
        label: input.label,
        order: input.order,
        type: 'binary',
        required: input.required,
        description: input.description,
        binaryKind: input.preset.binaryKind,
        mimeTypes: [...input.preset.mimeTypes]
    };
}

export interface INodeManifest {
    nodeType: string;
    displayName: string;
    category: string;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    configSchema?: object;
    deprecated?: boolean;
}

export interface ICostPolicy {
    runCostLimitUsd: number;
    costCurrency: 'USD';
    costPolicyVersion: number;
}

export interface IDagNode {
    nodeId: string;
    nodeType: string;
    dependsOn: string[];
    triggerPolicy?: string;
    retryPolicy?: string;
    timeoutMs?: number;
    config: TNodeConfigRecord;
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
    nodes: IDagNode[];
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
