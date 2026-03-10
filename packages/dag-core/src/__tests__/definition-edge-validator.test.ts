import { describe, expect, it } from 'vitest';
import { validateEdgesAndBindings } from '../services/definition-edge-validator.js';
import type { IDagDefinition, IPortDefinition } from '../types/domain.js';

function makeDefinition(overrides?: Partial<IDagDefinition>): IDagDefinition {
    return {
        dagId: 'dag-1',
        version: 1,
        status: 'draft',
        nodes: [
            {
                nodeId: 'A',
                nodeType: 'source',
                dependsOn: [],
                config: {},
                inputs: [],
                outputs: [{ key: 'out', type: 'string', required: true }]
            },
            {
                nodeId: 'B',
                nodeType: 'sink',
                dependsOn: ['A'],
                config: {},
                inputs: [{ key: 'in', type: 'string', required: true }],
                outputs: []
            }
        ],
        edges: [
            {
                from: 'A',
                to: 'B',
                bindings: [{ outputKey: 'out', inputKey: 'in' }]
            }
        ],
        ...overrides
    };
}

function nodeIdSet(def: IDagDefinition): Set<string> {
    return new Set(def.nodes.map((n) => n.nodeId));
}

function nodeById(def: IDagDefinition): Map<string, IDagDefinition['nodes'][number]> {
    return new Map(def.nodes.map((n) => [n.nodeId, n]));
}

describe('validateEdgesAndBindings', () => {
    it('returns no errors for valid edges', () => {
        const def = makeDefinition();
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors).toHaveLength(0);
    });

    it('detects edge.from referencing nonexistent node', () => {
        const def = makeDefinition({
            edges: [{ from: 'Z', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] }]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_EDGE_FROM_NOT_FOUND')).toBe(true);
    });

    it('detects edge.to referencing nonexistent node', () => {
        const def = makeDefinition({
            edges: [{ from: 'A', to: 'Z', bindings: [{ outputKey: 'out', inputKey: 'in' }] }]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_EDGE_TO_NOT_FOUND')).toBe(true);
    });

    it('detects edge with no bindings', () => {
        const def = makeDefinition({
            edges: [{ from: 'A', to: 'B', bindings: [] }]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_REQUIRED')).toBe(true);
    });

    it('detects edge with undefined bindings', () => {
        const def = makeDefinition({
            edges: [{ from: 'A', to: 'B' }]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_REQUIRED')).toBe(true);
    });

    it('detects nonexistent output port in binding', () => {
        const def = makeDefinition({
            edges: [{ from: 'A', to: 'B', bindings: [{ outputKey: 'missing', inputKey: 'in' }] }]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_OUTPUT_NOT_FOUND')).toBe(true);
    });

    it('detects nonexistent input port in binding', () => {
        const def = makeDefinition({
            edges: [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'missing' }] }]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_INPUT_NOT_FOUND')).toBe(true);
    });

    it('detects duplicate input key within same edge', () => {
        const def = makeDefinition();
        def.nodes[0].outputs = [
            { key: 'out1', type: 'string', required: true },
            { key: 'out2', type: 'string', required: true }
        ];
        def.edges = [{
            from: 'A',
            to: 'B',
            bindings: [
                { outputKey: 'out1', inputKey: 'in' },
                { outputKey: 'out2', inputKey: 'in' }
            ]
        }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_INPUT_KEY_DUPLICATE')).toBe(true);
    });

    it('detects type mismatch between output and input ports', () => {
        const def = makeDefinition();
        def.nodes[0].outputs = [{ key: 'out', type: 'number', required: true }];
        def.nodes[1].inputs = [{ key: 'in', type: 'string', required: true }];
        def.edges = [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_TYPE_MISMATCH')).toBe(true);
    });

    it('allows matching types', () => {
        const def = makeDefinition();
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors).toHaveLength(0);
    });

    it('detects cross-edge input key conflict', () => {
        const def = makeDefinition({
            nodes: [
                {
                    nodeId: 'A',
                    nodeType: 'source',
                    dependsOn: [],
                    config: {},
                    inputs: [],
                    outputs: [{ key: 'out', type: 'string', required: true }]
                },
                {
                    nodeId: 'B',
                    nodeType: 'source',
                    dependsOn: [],
                    config: {},
                    inputs: [],
                    outputs: [{ key: 'out', type: 'string', required: true }]
                },
                {
                    nodeId: 'C',
                    nodeType: 'sink',
                    dependsOn: ['A', 'B'],
                    config: {},
                    inputs: [{ key: 'in', type: 'string', required: true }],
                    outputs: []
                }
            ],
            edges: [
                { from: 'A', to: 'C', bindings: [{ outputKey: 'out', inputKey: 'in' }] },
                { from: 'B', to: 'C', bindings: [{ outputKey: 'out', inputKey: 'in' }] }
            ]
        });
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_INPUT_KEY_CONFLICT')).toBe(true);
    });

    it('detects cycle in DAG', () => {
        const def = makeDefinition({
            edges: [
                { from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] },
                { from: 'B', to: 'A', bindings: [{ outputKey: 'out', inputKey: 'in' }] }
            ]
        });
        // Add outputs to B and inputs to A for the reverse edge
        def.nodes[1].outputs = [{ key: 'out', type: 'string', required: true }];
        def.nodes[0].inputs = [{ key: 'in', type: 'string', required: true }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_CYCLE_DETECTED')).toBe(true);
    });

    it('validates binary port type compatibility', () => {
        const def = makeDefinition();
        def.nodes[0].outputs = [
            { key: 'out', type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }
        ];
        def.nodes[1].inputs = [
            { key: 'in', type: 'binary', required: true, binaryKind: 'video', mimeTypes: ['video/mp4'] }
        ];
        def.edges = [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_TYPE_MISMATCH')).toBe(true);
    });

    it('allows binary ports with matching kind and compatible mimeTypes', () => {
        const def = makeDefinition();
        def.nodes[0].outputs = [
            { key: 'out', type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png', 'image/jpeg'] }
        ];
        def.nodes[1].inputs = [
            { key: 'in', type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }
        ];
        def.edges = [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors).toHaveLength(0);
    });

    it('allows binary ports when one side has no binaryKind', () => {
        const def = makeDefinition();
        def.nodes[0].outputs = [
            { key: 'out', type: 'binary', required: true }
        ];
        def.nodes[1].inputs = [
            { key: 'in', type: 'binary', required: true, binaryKind: 'image' }
        ];
        def.edges = [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors).toHaveLength(0);
    });

    it('rejects binary ports when output has no matching mimeTypes', () => {
        const def = makeDefinition();
        def.nodes[0].outputs = [
            { key: 'out', type: 'binary', required: true, binaryKind: 'image', mimeTypes: [] }
        ];
        def.nodes[1].inputs = [
            { key: 'in', type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }
        ];
        def.edges = [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'in' }] }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_TYPE_MISMATCH')).toBe(true);
    });

    it('resolves list port handle keys in bindings', () => {
        const def = makeDefinition();
        def.nodes[1].inputs = [
            { key: 'images', type: 'binary', required: true, isList: true }
        ];
        def.edges = [{ from: 'A', to: 'B', bindings: [{ outputKey: 'out', inputKey: 'images[0]' }] }];
        const errors = validateEdgesAndBindings(def, nodeIdSet(def), nodeById(def));
        // Should not report input not found since images[0] resolves to list port 'images'
        expect(errors.some((e) => e.code === 'DAG_VALIDATION_BINDING_INPUT_NOT_FOUND')).toBe(false);
    });
});
