import {
    type IDagDefinition
} from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';
import { validateEdgesAndBindings } from './definition-edge-validator.js';

export { validateEdgesAndBindings } from './definition-edge-validator.js';

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

            if (node.nodeType === 'llm-text') {
                errors.push(
                    buildValidationError(
                        'DAG_VALIDATION_NODE_TYPE_REMOVED',
                        'nodeType llm-text has been removed. Use llm-text-openai instead.',
                        { nodeId: node.nodeId, nodeType: node.nodeType, replacementNodeType: 'llm-text-openai' }
                    )
                );
            }

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
                    if (typeof port.minItems === 'number' && (!Number.isInteger(port.minItems) || port.minItems < 0)) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_INVALID_INPUT_MIN_ITEMS',
                                'input port minItems must be a non-negative integer',
                                { nodeId: node.nodeId, key: port.key, minItems: port.minItems }
                            )
                        );
                    }
                    if (typeof port.maxItems === 'number' && (!Number.isInteger(port.maxItems) || port.maxItems < 0)) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_INVALID_INPUT_MAX_ITEMS',
                                'input port maxItems must be a non-negative integer',
                                { nodeId: node.nodeId, key: port.key, maxItems: port.maxItems }
                            )
                        );
                    }
                    if (
                        typeof port.minItems === 'number'
                        && typeof port.maxItems === 'number'
                        && port.minItems > port.maxItems
                    ) {
                        errors.push(
                            buildValidationError(
                                'DAG_VALIDATION_INVALID_INPUT_ITEM_RANGE',
                                'input port minItems must be less than or equal to maxItems',
                                { nodeId: node.nodeId, key: port.key, minItems: port.minItems, maxItems: port.maxItems }
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

        errors.push(...validateEdgesAndBindings(definition, nodeIdSet, nodeById));

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
