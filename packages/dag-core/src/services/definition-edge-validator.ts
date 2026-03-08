import {
    parseListPortHandleKey,
    type IDagDefinition,
    type IPortDefinition
} from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import { buildValidationError } from '../utils/error-builders.js';

function findPort(ports: IPortDefinition[], key: string): IPortDefinition | undefined {
    return ports.find((port) => port.key === key);
}

function resolveInputPort(
    ports: IPortDefinition[],
    bindingInputKey: string
): { portKey: string; port: IPortDefinition | undefined } {
    const directPort = findPort(ports, bindingInputKey);
    if (directPort) {
        return {
            portKey: bindingInputKey,
            port: directPort
        };
    }
    const listHandle = parseListPortHandleKey(bindingInputKey);
    if (!listHandle) {
        return {
            portKey: bindingInputKey,
            port: undefined
        };
    }
    const listPort = findPort(ports, listHandle.portKey);
    if (!listPort?.isList) {
        return {
            portKey: listHandle.portKey,
            port: undefined
        };
    }
    return {
        portKey: listHandle.portKey,
        port: listPort
    };
}

function isPortTypeCompatible(outputPort: IPortDefinition, inputPort: IPortDefinition): boolean {
    if (outputPort.type !== inputPort.type) {
        return false;
    }

    if (outputPort.type !== 'binary' || inputPort.type !== 'binary') {
        return true;
    }

    if (!outputPort.binaryKind || !inputPort.binaryKind) {
        return true;
    }

    if (outputPort.binaryKind !== inputPort.binaryKind) {
        return false;
    }

    if (!inputPort.mimeTypes || inputPort.mimeTypes.length === 0) {
        return true;
    }

    if (!outputPort.mimeTypes || outputPort.mimeTypes.length === 0) {
        return false;
    }

    return outputPort.mimeTypes.some((mimeType) => inputPort.mimeTypes?.includes(mimeType));
}

/**
 * Validates edges, bindings, cross-edge input key conflicts, and cycle detection
 * for a DAG definition.
 */
export function validateEdgesAndBindings(
    definition: IDagDefinition,
    nodeIdSet: Set<string>,
    nodeById: Map<string, IDagDefinition['nodes'][number]>
): IDagError[] {
    const errors: IDagError[] = [];

    for (const edge of definition.edges) {
        if (!nodeIdSet.has(edge.from)) {
            errors.push(
                buildValidationError(
                    'DAG_VALIDATION_EDGE_FROM_NOT_FOUND',
                    'edge.from must reference an existing nodeId',
                    { from: edge.from }
                )
            );
        }

        if (!nodeIdSet.has(edge.to)) {
            errors.push(
                buildValidationError(
                    'DAG_VALIDATION_EDGE_TO_NOT_FOUND',
                    'edge.to must reference an existing nodeId',
                    { to: edge.to }
                )
            );
        }

        if (!edge.bindings || edge.bindings.length === 0) {
            errors.push(
                buildValidationError(
                    'DAG_VALIDATION_BINDING_REQUIRED',
                    'Each edge must define at least one binding',
                    { from: edge.from, to: edge.to }
                )
            );
            continue;
        }

        const fromNode = nodeById.get(edge.from);
        const toNode = nodeById.get(edge.to);
        if (!fromNode || !toNode) {
            continue;
        }

        const outputPorts = fromNode.outputs ?? [];
        const inputPorts = toNode.inputs ?? [];
        const inputKeysInEdge = new Set<string>();

        for (const binding of edge.bindings) {
            const outputPort = findPort(outputPorts, binding.outputKey);
            if (!outputPort) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_BINDING_OUTPUT_NOT_FOUND',
                        'binding.outputKey must reference an existing output port',
                        {
                            from: edge.from,
                            outputKey: binding.outputKey
                        }
                    )
                );
            }

            const resolvedInput = resolveInputPort(inputPorts, binding.inputKey);
            const inputPort = resolvedInput.port;
            if (!inputPort) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_BINDING_INPUT_NOT_FOUND',
                        'binding.inputKey must reference an existing input port',
                        {
                            to: edge.to,
                            inputKey: binding.inputKey
                        }
                    )
                );
            }

            const bindingInputIdentity = resolvedInput.port?.isList
                ? binding.inputKey
                : resolvedInput.portKey;
            if (inputKeysInEdge.has(bindingInputIdentity)) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_BINDING_INPUT_KEY_DUPLICATE',
                        'Each edge must not map multiple outputs to the same inputKey',
                        { to: edge.to, inputKey: binding.inputKey }
                    )
                );
            } else {
                inputKeysInEdge.add(bindingInputIdentity);
            }

            if (outputPort && inputPort && !isPortTypeCompatible(outputPort, inputPort)) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_BINDING_TYPE_MISMATCH',
                        'binding port types must match',
                        {
                            from: edge.from,
                            to: edge.to,
                            outputKey: binding.outputKey,
                            inputKey: binding.inputKey,
                            outputType: outputPort.type,
                            inputType: inputPort.type
                        }
                    )
                );
            }
        }
    }

    const usedInputKeysByTarget = new Map<string, Set<string>>();
    for (const edge of definition.edges) {
        if (!edge.bindings) {
            continue;
        }
        const key = edge.to;
        const used = usedInputKeysByTarget.get(key) ?? new Set<string>();
        for (const binding of edge.bindings) {
            const toNode = nodeById.get(edge.to);
            const resolvedInput = resolveInputPort(toNode?.inputs ?? [], binding.inputKey);
            const bindingInputIdentity = resolvedInput.port?.isList
                ? binding.inputKey
                : resolvedInput.portKey;
            if (used.has(bindingInputIdentity)) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_BINDING_INPUT_KEY_CONFLICT',
                        'Multiple upstream edges map to the same inputKey',
                        { to: edge.to, inputKey: binding.inputKey }
                    )
                );
            } else {
                used.add(bindingInputIdentity);
            }
        }
        usedInputKeysByTarget.set(key, used);
    }

    const outgoingEdges = new Map<string, string[]>();
    for (const edge of definition.edges) {
        const existing = outgoingEdges.get(edge.from) ?? [];
        existing.push(edge.to);
        outgoingEdges.set(edge.from, existing);
    }

    const nodeIds = [...nodeIdSet];
    if (hasCycleByNodeIds(nodeIds, outgoingEdges)) {
        errors.push(
            buildValidationError('DAG_VALIDATION_CYCLE_DETECTED', 'DAG must not contain cycles')
        );
    }

    return errors;
}

function hasCycleByNodeIds(nodeIds: string[], outgoingEdges: Map<string, string[]>): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (nodeId: string): boolean => {
        if (visiting.has(nodeId)) {
            return true;
        }

        if (visited.has(nodeId)) {
            return false;
        }

        visiting.add(nodeId);
        const nextNodeIds = outgoingEdges.get(nodeId) ?? [];

        for (const nextNodeId of nextNodeIds) {
            if (visit(nextNodeId)) {
                return true;
            }
        }

        visiting.delete(nodeId);
        visited.add(nodeId);
        return false;
    };

    for (const nodeId of nodeIds) {
        if (visit(nodeId)) {
            return true;
        }
    }

    return false;
}
