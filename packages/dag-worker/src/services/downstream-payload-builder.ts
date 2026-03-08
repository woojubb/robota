import {
    buildValidationError,
    parseListPortHandleKey,
    type IDagDefinition,
    type IDagError,
    type ITaskRun,
    type TPortPayload,
    type TPortValue,
    type TResult
} from '@robota-sdk/dag-core';

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return 'Unknown error';
}

/** Checks whether a parsed JSON value has a valid TPortPayload shape. */
function isPortPayload(input: unknown): input is TPortPayload {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}

/**
 * Builds the aggregated input payload for a downstream node by resolving
 * upstream output snapshots through edge bindings.
 *
 * @param definition - The DAG definition containing nodes and edges.
 * @param taskRuns - All task runs for the current DAG run.
 * @param downstreamNodeId - The node whose input payload is being built.
 * @returns The resolved payload or a validation error.
 */
export function buildDownstreamPayload(
    definition: IDagDefinition,
    taskRuns: ITaskRun[],
    downstreamNodeId: string
): TResult<TPortPayload, IDagError> {
    const downstreamNode = definition.nodes.find((node) => node.nodeId === downstreamNodeId);
    if (!downstreamNode) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_DOWNSTREAM_NODE_NOT_FOUND',
                'Downstream node was not found while building payload',
                { downstreamNodeId }
            )
        };
    }

    const incomingEdges = definition.edges.filter((edge) => edge.to === downstreamNodeId);
    if (incomingEdges.length === 0) {
        return { ok: true, value: {} };
    }

    const payload: TPortPayload = {};
    for (const edge of incomingEdges) {
        const edgeResult = applyEdgeBindings(payload, edge, downstreamNode, taskRuns);
        if (!edgeResult.ok) {
            return edgeResult;
        }
    }

    compactListPorts(payload, downstreamNode.inputs);

    return { ok: true, value: payload };
}

/** Applies all bindings from a single edge onto the accumulating payload. */
function applyEdgeBindings(
    payload: TPortPayload,
    edge: IDagDefinition['edges'][number],
    downstreamNode: IDagDefinition['nodes'][number],
    taskRuns: ITaskRun[]
): TResult<void, IDagError> {
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

    const upstreamOutputResult = resolveUpstreamOutput(edge.from, edge.to, taskRuns);
    if (!upstreamOutputResult.ok) {
        return upstreamOutputResult;
    }
    const upstreamOutput = upstreamOutputResult.value;

    for (const binding of edge.bindings) {
        const bindResult = applySingleBinding(payload, binding, upstreamOutput, edge, downstreamNode);
        if (!bindResult.ok) {
            return bindResult;
        }
    }

    return { ok: true, value: undefined };
}

/** Resolves and parses the output snapshot from an upstream task run. */
function resolveUpstreamOutput(
    fromNodeId: string,
    toNodeId: string,
    taskRuns: ITaskRun[]
): TResult<TPortPayload, IDagError> {
    const upstreamTask = taskRuns.find((taskRun) => taskRun.nodeId === fromNodeId && taskRun.status === 'success');
    if (!upstreamTask || !upstreamTask.outputSnapshot) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_UPSTREAM_OUTPUT_MISSING',
                'Upstream output snapshot is missing for binding dispatch',
                { from: fromNodeId, to: toNodeId }
            )
        };
    }

    try {
        const parsed = JSON.parse(upstreamTask.outputSnapshot);
        if (!isPortPayload(parsed)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_UPSTREAM_OUTPUT_INVALID',
                    'Upstream output snapshot has invalid payload shape',
                    { from: fromNodeId, to: toNodeId }
                )
            };
        }
        return { ok: true, value: parsed };
    } catch (error) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_UPSTREAM_OUTPUT_PARSE_FAILED',
                'Failed to parse upstream output snapshot',
                {
                    from: fromNodeId,
                    to: toNodeId,
                    errorMessage: resolveErrorMessage(error)
                }
            )
        };
    }
}

/** Applies a single binding entry, handling direct, list, and indexed-list ports. */
function applySingleBinding(
    payload: TPortPayload,
    binding: { outputKey: string; inputKey: string },
    upstreamOutput: TPortPayload,
    edge: { from: string; to: string },
    downstreamNode: IDagDefinition['nodes'][number]
): TResult<void, IDagError> {
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

    const directInputPort = downstreamNode.inputs.find((port) => port.key === binding.inputKey);
    if (directInputPort?.isList) {
        return applyListBinding(payload, binding.inputKey, outputValue, edge.to);
    }

    const listHandle = parseListPortHandleKey(binding.inputKey);
    if (listHandle) {
        return applyIndexedListBinding(payload, listHandle, outputValue, binding.inputKey, edge.to, downstreamNode);
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

    return { ok: true, value: undefined };
}

/** Pushes a value onto a list-type input port. */
function applyListBinding(
    payload: TPortPayload,
    inputKey: string,
    outputValue: TPortValue,
    toNodeId: string
): TResult<void, IDagError> {
    if (!Array.isArray(payload[inputKey])) {
        payload[inputKey] = [];
    }
    const listPayload = payload[inputKey];
    if (!Array.isArray(listPayload)) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_BINDING_LIST_PAYLOAD_INVALID',
                'List payload container is invalid',
                { to: toNodeId, inputKey }
            )
        };
    }
    listPayload.push(outputValue);
    return { ok: true, value: undefined };
}

/** Assigns a value at a specific index of a list-type input port. */
function applyIndexedListBinding(
    payload: TPortPayload,
    listHandle: { portKey: string; index: number },
    outputValue: TPortValue,
    inputKey: string,
    toNodeId: string,
    downstreamNode: IDagDefinition['nodes'][number]
): TResult<void, IDagError> {
    const listPort = downstreamNode.inputs.find((port) => port.key === listHandle.portKey);
    if (!listPort?.isList) {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_BINDING_INPUT_KEY_MISSING',
                'Binding inputKey does not resolve to a valid list input port',
                { to: toNodeId, inputKey }
            )
        };
    }
    const existingListValue = payload[listHandle.portKey];
    const listPayload = Array.isArray(existingListValue) ? existingListValue : [];
    listPayload[listHandle.index] = outputValue;
    payload[listHandle.portKey] = listPayload;
    return { ok: true, value: undefined };
}

/** Removes undefined holes from list-type port values. */
function compactListPorts(
    payload: TPortPayload,
    inputs: IDagDefinition['nodes'][number]['inputs']
): void {
    for (const port of inputs) {
        if (!port.isList) {
            continue;
        }
        const listValue = payload[port.key];
        if (!Array.isArray(listValue)) {
            continue;
        }
        payload[port.key] = listValue.filter((item) => typeof item !== 'undefined');
    }
}
