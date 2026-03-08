import { describe, it, expect } from 'vitest';
import { DagDefinitionValidator } from '../services/definition-validator.js';
import type { IDagDefinition, IDagNode } from '../types/domain.js';

function createMinimalNode(nodeId: string, nodeType: string, overrides: Partial<IDagNode> = {}): IDagNode {
    return {
        nodeId,
        nodeType,
        dependsOn: [],
        config: {},
        inputs: [],
        outputs: [],
        ...overrides,
    };
}

function createValidDefinition(overrides: Partial<IDagDefinition> = {}): IDagDefinition {
    return {
        dagId: 'test-dag',
        version: 1,
        status: 'draft',
        nodes: [
            createMinimalNode('node-a', 'custom', {
                outputs: [{ key: 'out', type: 'string', required: true }],
            }),
            createMinimalNode('node-b', 'custom', {
                dependsOn: ['node-a'],
                inputs: [{ key: 'in', type: 'string', required: true }],
            }),
        ],
        edges: [
            {
                from: 'node-a',
                to: 'node-b',
                bindings: [{ outputKey: 'out', inputKey: 'in' }],
            },
        ],
        ...overrides,
    };
}

function findErrorCode(result: ReturnType<typeof DagDefinitionValidator.validate>, code: string): boolean {
    if (result.ok) return false;
    return result.error.some((e) => e.code === code);
}

describe('DagDefinitionValidator', () => {
    describe('valid definitions', () => {
        it('should accept a structurally valid definition', () => {
            const result = DagDefinitionValidator.validate(createValidDefinition());
            expect(result.ok).toBe(true);
        });

        it('should return the definition as value on success', () => {
            const def = createValidDefinition();
            const result = DagDefinitionValidator.validate(def);
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toBe(def);
        });
    });

    describe('dagId validation', () => {
        it('should fail when dagId is empty', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({ dagId: '' })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_EMPTY_DAG_ID')).toBe(true);
        });

        it('should fail when dagId is whitespace only', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({ dagId: '   ' })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_EMPTY_DAG_ID')).toBe(true);
        });
    });

    describe('version validation', () => {
        it('should fail when version is zero', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({ version: 0 })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_INVALID_VERSION')).toBe(true);
        });

        it('should fail when version is negative', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({ version: -1 })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_INVALID_VERSION')).toBe(true);
        });
    });

    describe('node validation', () => {
        it('should fail when nodes array is empty', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({ nodes: [], edges: [] })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_EMPTY_NODES')).toBe(true);
        });

        it('should fail when duplicate nodeIds exist', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    nodes: [
                        createMinimalNode('dup', 'custom'),
                        createMinimalNode('dup', 'custom'),
                    ],
                    edges: [],
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_DUPLICATE_NODE_ID')).toBe(true);
        });

        it('should fail when nodeId is empty', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    nodes: [createMinimalNode('', 'custom')],
                    edges: [],
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_EMPTY_NODE_ID')).toBe(true);
        });
    });

    describe('edge validation', () => {
        it('should fail when edge references non-existent source node', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    edges: [
                        {
                            from: 'non-existent',
                            to: 'node-b',
                            bindings: [{ outputKey: 'out', inputKey: 'in' }],
                        },
                    ],
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_EDGE_FROM_NOT_FOUND')).toBe(true);
        });

        it('should fail when edge references non-existent target node', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    edges: [
                        {
                            from: 'node-a',
                            to: 'non-existent',
                            bindings: [{ outputKey: 'out', inputKey: 'in' }],
                        },
                    ],
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_EDGE_TO_NOT_FOUND')).toBe(true);
        });

        it('should fail when edge has no bindings', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    edges: [
                        { from: 'node-a', to: 'node-b', bindings: [] },
                    ],
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_BINDING_REQUIRED')).toBe(true);
        });
    });

    describe('cycle detection', () => {
        it('should fail when edges form a cycle', () => {
            const result = DagDefinitionValidator.validate({
                dagId: 'cycle-dag',
                version: 1,
                status: 'draft',
                nodes: [
                    createMinimalNode('a', 'custom', {
                        inputs: [{ key: 'in', type: 'string', required: true }],
                        outputs: [{ key: 'out', type: 'string', required: true }],
                    }),
                    createMinimalNode('b', 'custom', {
                        dependsOn: ['a'],
                        inputs: [{ key: 'in', type: 'string', required: true }],
                        outputs: [{ key: 'out', type: 'string', required: true }],
                    }),
                ],
                edges: [
                    { from: 'a', to: 'b', bindings: [{ outputKey: 'out', inputKey: 'in' }] },
                    { from: 'b', to: 'a', bindings: [{ outputKey: 'out', inputKey: 'in' }] },
                ],
            });
            expect(findErrorCode(result, 'DAG_VALIDATION_CYCLE_DETECTED')).toBe(true);
        });
    });

    describe('costPolicy validation', () => {
        it('should fail when runCostLimitUsd is zero', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    costPolicy: { runCostLimitUsd: 0, costCurrency: 'USD', costPolicyVersion: 1 },
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_INVALID_COST_LIMIT')).toBe(true);
        });

        it('should fail when costPolicyVersion is negative', () => {
            const result = DagDefinitionValidator.validate(
                createValidDefinition({
                    costPolicy: { runCostLimitUsd: 10, costCurrency: 'USD', costPolicyVersion: -1 },
                })
            );
            expect(findErrorCode(result, 'DAG_VALIDATION_INVALID_COST_POLICY_VERSION')).toBe(true);
        });
    });

    describe('multiple errors', () => {
        it('should collect all errors instead of stopping at the first one', () => {
            const result = DagDefinitionValidator.validate({
                dagId: '',
                version: 0,
                status: 'draft',
                nodes: [],
                edges: [],
            });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.length).toBeGreaterThanOrEqual(3);
            expect(findErrorCode(result, 'DAG_VALIDATION_EMPTY_DAG_ID')).toBe(true);
            expect(findErrorCode(result, 'DAG_VALIDATION_INVALID_VERSION')).toBe(true);
            expect(findErrorCode(result, 'DAG_VALIDATION_EMPTY_NODES')).toBe(true);
        });
    });
});
