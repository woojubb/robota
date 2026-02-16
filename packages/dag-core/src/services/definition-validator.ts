import type { IDagDefinition, IPortDefinition } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';

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

export class DagDefinitionValidator {
    public static validate(definition: IDagDefinition): TResult<IDagDefinition, IDagError[]> {
        const errors: IDagError[] = [];

        if (definition.dagId.trim().length === 0) {
            errors.push(
                buildValidationError('DAG_VALIDATION_EMPTY_DAG_ID', 'dagId must not be empty')
            );
        }

        if (definition.version <= 0) {
            errors.push(
                buildValidationError(
                    'DAG_VALIDATION_INVALID_VERSION',
                    'version must be a positive integer',
                    { version: definition.version }
                )
            );
        }

        if (definition.nodes.length === 0) {
            errors.push(
                buildValidationError('DAG_VALIDATION_EMPTY_NODES', 'DAG must include at least one node')
            );
        }

        const nodeIdSet = new Set<string>();
        const nodeById = new Map<string, IDagDefinition['nodes'][number]>();
        for (const node of definition.nodes) {
            if (node.nodeId.trim().length === 0) {
                errors.push(
                    buildValidationError('DAG_VALIDATION_EMPTY_NODE_ID', 'nodeId must not be empty')
                );
                continue;
            }

            if (nodeIdSet.has(node.nodeId)) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_DUPLICATE_NODE_ID',
                        'nodeId must be unique',
                        { nodeId: node.nodeId }
                    )
                );
                continue;
            }

            nodeIdSet.add(node.nodeId);
            nodeById.set(node.nodeId, node);

            if (node.inputs) {
                const inputKeys = new Set<string>();
                for (const port of node.inputs) {
                    if (port.key.trim().length === 0) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_EMPTY_INPUT_KEY',
                                'input port key must not be empty',
                                { nodeId: node.nodeId }
                            )
                        );
                        continue;
                    }
                    if (typeof port.order === 'number' && (!Number.isInteger(port.order) || port.order < 0)) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_INVALID_INPUT_ORDER',
                                'input port order must be a non-negative integer',
                                { nodeId: node.nodeId, key: port.key, order: port.order }
                            )
                        );
                    }
                    if (inputKeys.has(port.key)) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_DUPLICATE_INPUT_KEY',
                                'input port key must be unique in a node',
                                { nodeId: node.nodeId, key: port.key }
                            )
                        );
                        continue;
                    }
                    inputKeys.add(port.key);
                }
            }

            if (node.outputs) {
                const outputKeys = new Set<string>();
                for (const port of node.outputs) {
                    if (port.key.trim().length === 0) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_EMPTY_OUTPUT_KEY',
                                'output port key must not be empty',
                                { nodeId: node.nodeId }
                            )
                        );
                        continue;
                    }
                    if (typeof port.order === 'number' && (!Number.isInteger(port.order) || port.order < 0)) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_INVALID_OUTPUT_ORDER',
                                'output port order must be a non-negative integer',
                                { nodeId: node.nodeId, key: port.key, order: port.order }
                            )
                        );
                    }
                    if (outputKeys.has(port.key)) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_DUPLICATE_OUTPUT_KEY',
                                'output port key must be unique in a node',
                                { nodeId: node.nodeId, key: port.key }
                            )
                        );
                        continue;
                    }
                    outputKeys.add(port.key);
                }
            }
        }

        const hasOkEmitterNode = definition.nodes.some((node) => node.nodeType === 'ok-emitter');
        if (hasOkEmitterNode) {
            const entryNodes = definition.nodes.filter((node) => node.dependsOn.length === 0);
            if (entryNodes.length !== 1) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_TEST_ENTRY_NODE_COUNT_INVALID',
                        'Test DAG with ok-emitter must have exactly one entry node',
                        { entryNodeCount: entryNodes.length }
                    )
                );
            } else if (entryNodes[0]?.nodeType !== 'image-source') {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_TEST_ENTRY_NODE_TYPE_INVALID',
                        'Test DAG entry node must be image-source when ok-emitter exists',
                        { entryNodeType: entryNodes[0]?.nodeType }
                    )
                );
            }
        }

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

                const inputPort = findPort(inputPorts, binding.inputKey);
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

                if (inputKeysInEdge.has(binding.inputKey)) {
                    errors.push(
                        buildValidationError(
                            'DAG_VALIDATION_BINDING_INPUT_KEY_DUPLICATE',
                            'Each edge must not map multiple outputs to the same inputKey',
                            { to: edge.to, inputKey: binding.inputKey }
                        )
                    );
                } else {
                    inputKeysInEdge.add(binding.inputKey);
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
                if (used.has(binding.inputKey)) {
                    errors.push(
                        buildValidationError(
                            'DAG_VALIDATION_BINDING_INPUT_KEY_CONFLICT',
                            'Multiple upstream edges map to the same inputKey',
                            { to: edge.to, inputKey: binding.inputKey }
                        )
                    );
                } else {
                    used.add(binding.inputKey);
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

        if (definition.costPolicy) {
            if (definition.costPolicy.runCostLimitUsd <= 0) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_INVALID_COST_LIMIT',
                        'costPolicy.runCostLimitUsd must be positive',
                        { runCostLimitUsd: definition.costPolicy.runCostLimitUsd }
                    )
                );
            }
            if (definition.costPolicy.costPolicyVersion <= 0) {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_INVALID_COST_POLICY_VERSION',
                        'costPolicy.costPolicyVersion must be positive',
                        { costPolicyVersion: definition.costPolicy.costPolicyVersion }
                    )
                );
            }
        }

        if (errors.length > 0) {
            return {
                ok: false,
                error: errors
            };
        }

        return {
            ok: true,
            value: definition
        };
    }
}

function findPort(ports: IPortDefinition[], key: string): IPortDefinition | undefined {
    return ports.find((port) => port.key === key);
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
