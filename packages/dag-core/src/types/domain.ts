/** Publication state of a DAG definition. */
export type TDagDefinitionStatus = 'draft' | 'published' | 'deprecated';
/** Supported value types for node port definitions. */
export type TPortValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'binary';
/** Kind of binary data a port can accept or produce. */
export type TBinaryKind = 'image' | 'video' | 'audio' | 'file';
/** Primitive values allowed in node configuration. */
export type TNodeConfigPrimitive = string | number | boolean | null;
/** Nested configuration object for a DAG node. */
export interface INodeConfigObject {
    [key: string]: TNodeConfigValue;
}
/** Any value that can appear inside a node's config. */
export type TNodeConfigValue = TNodeConfigPrimitive | INodeConfigObject | TNodeConfigValue[];
/** Top-level node configuration record. Alias for INodeConfigObject. */
export type TNodeConfigRecord = INodeConfigObject;

/** Discriminant for asset reference resolution strategy. */
export type TAssetReferenceType = 'asset' | 'uri';

/** Common fields shared by all asset reference variants. */
export interface IAssetReferenceBase {
    referenceType: TAssetReferenceType;
    mediaType?: string;
    name?: string;
    sizeBytes?: number;
}

/** Asset reference resolved by internal asset ID. */
export interface IAssetReferenceByAssetId extends IAssetReferenceBase {
    referenceType: 'asset';
    assetId: string;
    uri?: never;
}

/** Asset reference resolved by external URI. */
export interface IAssetReferenceByUri extends IAssetReferenceBase {
    referenceType: 'uri';
    uri: string;
    assetId?: never;
}

/** Discriminated union of asset references — either by asset ID or by URI. */
export type TAssetReference = IAssetReferenceByAssetId | IAssetReferenceByUri;

/** Lifecycle status of a DAG run. Terminal states: success, failed, cancelled. */
export type TDagRunStatus =
    | 'created'
    | 'queued'
    | 'running'
    | 'success'
    | 'failed'
    | 'cancelled';

/** Lifecycle status of a task run. Terminal states: success, failed, upstream_failed, skipped, cancelled. */
export type TTaskRunStatus =
    | 'created'
    | 'queued'
    | 'running'
    | 'success'
    | 'failed'
    | 'upstream_failed'
    | 'skipped'
    | 'cancelled';

/** How a DAG run was initiated. */
export type TDagTriggerType = 'manual' | 'scheduled' | 'api';

/** Schema for a single input or output port on a DAG node. */
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

/** Pre-configured binary kind and MIME type combination for port definitions. */
export interface IBinaryPortPreset {
    binaryKind: TBinaryKind;
    mimeTypes: readonly string[];
}

/** Common binary port presets for image, video, audio, and file ports. */
export const BINARY_PORT_PRESETS = {
    IMAGE_PNG: { binaryKind: 'image', mimeTypes: ['image/png'] },
    IMAGE_COMMON: { binaryKind: 'image', mimeTypes: ['image/png', 'image/jpeg', 'image/webp'] },
    VIDEO_MP4: { binaryKind: 'video', mimeTypes: ['video/mp4'] },
    AUDIO_MPEG: { binaryKind: 'audio', mimeTypes: ['audio/mpeg'] },
    FILE_GENERIC: { binaryKind: 'file', mimeTypes: [] }
} as const;

/** Input for {@link createBinaryPortDefinition} factory. */
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

/**
 * Create an {@link IPortDefinition} for a binary port from a preset-based input.
 * @param input - Binary port specification including preset, key, and constraints
 * @returns A fully populated port definition with type `'binary'`
 */
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

/** Read-only metadata describing a registered node type's capabilities. */
export interface INodeManifest {
    nodeType: string;
    displayName: string;
    category: string;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    configSchema?: Record<string, unknown>;
    deprecated?: boolean;
}

/** Budget constraints for a DAG run or individual node execution. */
export interface ICostPolicy {
    runCostLimitUsd: number;
    costCurrency: 'USD';
    costPolicyVersion: number;
}

/** A single node within a DAG definition, including its config, ports, and policies. */
export interface IDagNode {
    nodeId: string;
    nodeType: string;
    position?: { x: number; y: number };
    dependsOn: string[];
    triggerPolicy?: string;
    retryPolicy?: string;
    timeoutMs?: number;
    config: INodeConfigObject;
    inputs: IPortDefinition[];
    outputs: IPortDefinition[];
    costPolicy?: ICostPolicy;
}

/** Maps an output port key of the source node to an input port key of the target node. */
export interface IEdgeBinding {
    outputKey: string;
    inputKey: string;
}

const LIST_PORT_HANDLE_PREFIX_SEPARATOR = '[';
const LIST_PORT_HANDLE_SUFFIX = ']';

/** Build a handle key for an indexed list port element, e.g. `"images[0]"`. */
export function buildListPortHandleKey(portKey: string, index: number): string {
    return `${portKey}${LIST_PORT_HANDLE_PREFIX_SEPARATOR}${index}${LIST_PORT_HANDLE_SUFFIX}`;
}

/** Parse a list port handle key back into its port key and index. Returns `undefined` if the key is not a valid list handle. */
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

/** A directed edge between two nodes in a DAG definition with optional port bindings. */
export interface IDagEdgeDefinition {
    from: string;
    to: string;
    bindings?: IEdgeBinding[];
}

/** Complete versioned DAG definition — the blueprint for a DAG run. */
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

/** Runtime record of a single DAG execution instance. */
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

/** Runtime record of a single task (node) execution within a DAG run. */
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

/** A key-value pair forming one segment of a hierarchical execution path. */
export interface IExecutionPathSegment {
    key: 'dagId' | 'dagRunId' | 'nodeId' | 'taskRunId' | 'attempt';
    value: string;
}
