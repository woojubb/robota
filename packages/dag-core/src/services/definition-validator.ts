import type { IDagDefinition } from '../types/domain.js';
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
