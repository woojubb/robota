export type TDagDefinitionStatus = 'draft' | 'published' | 'deprecated';
export type TPortValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'binary';
export type TBinaryKind = 'image' | 'video' | 'audio' | 'file';
export type TNodeConfigPrimitive = string | number | boolean | null;
export interface INodeConfigObject {
    [key: string]: TNodeConfigValue;
}
export type TNodeConfigValue = TNodeConfigPrimitive | INodeConfigObject | TNodeConfigValue[];
export type TNodeConfigRecord = INodeConfigObject;

export type TAssetReferenceType = 'asset' | 'uri';

export interface TAssetReferenceBase {
    referenceType: TAssetReferenceType;
    mediaType?: string;
    name?: string;
    sizeBytes?: number;
}

export interface TAssetReferenceByAssetId extends TAssetReferenceBase {
    referenceType: 'asset';
    assetId: string;
    uri?: never;
}

export interface TAssetReferenceByUri extends TAssetReferenceBase {
    referenceType: 'uri';
    uri: string;
    assetId?: never;
}

export type TAssetReference = TAssetReferenceByAssetId | TAssetReferenceByUri;

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
    isList?: boolean;
    minItems?: number;
    maxItems?: number;
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
    isList?: boolean;
    minItems?: number;
    maxItems?: number;
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
        mimeTypes: [...input.preset.mimeTypes],
        isList: input.isList,
        minItems: input.minItems,
        maxItems: input.maxItems
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
    position?: { x: number; y: number };
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

const LIST_PORT_HANDLE_PREFIX_SEPARATOR = '[';
const LIST_PORT_HANDLE_SUFFIX = ']';

export function buildListPortHandleKey(portKey: string, index: number): string {
    return `${portKey}${LIST_PORT_HANDLE_PREFIX_SEPARATOR}${index}${LIST_PORT_HANDLE_SUFFIX}`;
}

export function parseListPortHandleKey(handleKey: string): { portKey: string; index: number } | undefined {
    const startIndex = handleKey.lastIndexOf(LIST_PORT_HANDLE_PREFIX_SEPARATOR);
    if (startIndex <= 0 || !handleKey.endsWith(LIST_PORT_HANDLE_SUFFIX)) {
        return undefined;
    }
    const portKey = handleKey.slice(0, startIndex);
    const rawIndex = handleKey.slice(startIndex + 1, handleKey.length - 1);
    if (!/^\d+$/.test(rawIndex)) {
        return undefined;
    }
    return {
        portKey,
        index: Number.parseInt(rawIndex, 10)
    };
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
    definitionSnapshot?: string;
    inputSnapshot?: string;
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
    estimatedCostUsd?: number;
    totalCostUsd?: number;
    errorCode?: string;
    errorMessage?: string;
}

export interface IExecutionPathSegment {
    key: 'dagId' | 'dagRunId' | 'nodeId' | 'taskRunId' | 'attempt';
    value: string;
}
