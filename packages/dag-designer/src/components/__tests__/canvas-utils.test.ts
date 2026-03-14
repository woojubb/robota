import { describe, it, expect } from 'vitest';
import type { IDagDefinition, IPortDefinition } from '@robota-sdk/dag-core';
import { compactListBindings, computeInputHandlesByPortKey } from '../canvas-utils';

function makeListPort(key: string): IPortDefinition {
    return { key, type: 'binary', required: true, isList: true };
}

function makeScalarPort(key: string): IPortDefinition {
    return { key, type: 'string', required: true };
}

describe('compactListBindings', () => {
    it('re-indexes list bindings across multiple edges to the same target', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'src_a', nodeType: 'source', dependsOn: [], inputs: [], outputs: [{ key: 'image', type: 'binary', required: true }], config: {} },
                { nodeId: 'src_b', nodeType: 'source', dependsOn: [], inputs: [], outputs: [{ key: 'image', type: 'binary', required: true }], config: {} },
                { nodeId: 'target', nodeType: 'compose', dependsOn: ['src_a', 'src_b'], inputs: [makeListPort('images')], outputs: [], config: {} }
            ],
            edges: [
                { from: 'src_a', to: 'target', bindings: [{ outputKey: 'image', inputKey: 'images[0]' }] },
                { from: 'src_b', to: 'target', bindings: [{ outputKey: 'image', inputKey: 'images[5]' }] }
            ]
        };

        const result = compactListBindings(definition);

        expect(result.edges[0].bindings[0].inputKey).toBe('images[0]');
        expect(result.edges[1].bindings[0].inputKey).toBe('images[1]');
    });

    it('handles three edges to the same list port', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'a', nodeType: 's', dependsOn: [], inputs: [], outputs: [{ key: 'out', type: 'binary', required: true }], config: {} },
                { nodeId: 'b', nodeType: 's', dependsOn: [], inputs: [], outputs: [{ key: 'out', type: 'binary', required: true }], config: {} },
                { nodeId: 'c', nodeType: 's', dependsOn: [], inputs: [], outputs: [{ key: 'out', type: 'binary', required: true }], config: {} },
                { nodeId: 'target', nodeType: 't', dependsOn: ['a', 'b', 'c'], inputs: [makeListPort('items')], outputs: [], config: {} }
            ],
            edges: [
                { from: 'a', to: 'target', bindings: [{ outputKey: 'out', inputKey: 'items[0]' }] },
                { from: 'b', to: 'target', bindings: [{ outputKey: 'out', inputKey: 'items[0]' }] },
                { from: 'c', to: 'target', bindings: [{ outputKey: 'out', inputKey: 'items[0]' }] }
            ]
        };

        const result = compactListBindings(definition);

        expect(result.edges[0].bindings[0].inputKey).toBe('items[0]');
        expect(result.edges[1].bindings[0].inputKey).toBe('items[1]');
        expect(result.edges[2].bindings[0].inputKey).toBe('items[2]');
    });

    it('does not affect scalar bindings', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'src', nodeType: 's', dependsOn: [], inputs: [], outputs: [{ key: 'text', type: 'string', required: true }], config: {} },
                { nodeId: 'target', nodeType: 't', dependsOn: ['src'], inputs: [makeScalarPort('prompt')], outputs: [], config: {} }
            ],
            edges: [
                { from: 'src', to: 'target', bindings: [{ outputKey: 'text', inputKey: 'prompt' }] }
            ]
        };

        const result = compactListBindings(definition);

        expect(result.edges[0].bindings[0].inputKey).toBe('prompt');
    });

    it('handles mixed scalar and list bindings in the same edge', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'src', nodeType: 's', dependsOn: [], inputs: [], outputs: [
                    { key: 'text', type: 'string', required: true },
                    { key: 'img', type: 'binary', required: true }
                ], config: {} },
                { nodeId: 'target', nodeType: 't', dependsOn: ['src'], inputs: [
                    makeScalarPort('prompt'),
                    makeListPort('images')
                ], outputs: [], config: {} }
            ],
            edges: [
                { from: 'src', to: 'target', bindings: [
                    { outputKey: 'text', inputKey: 'prompt' },
                    { outputKey: 'img', inputKey: 'images[3]' }
                ] }
            ]
        };

        const result = compactListBindings(definition);

        expect(result.edges[0].bindings[0].inputKey).toBe('prompt');
        expect(result.edges[0].bindings[1].inputKey).toBe('images[0]');
    });

    it('keeps independent target nodes separate', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'src', nodeType: 's', dependsOn: [], inputs: [], outputs: [{ key: 'out', type: 'binary', required: true }], config: {} },
                { nodeId: 'target_a', nodeType: 't', dependsOn: ['src'], inputs: [makeListPort('items')], outputs: [], config: {} },
                { nodeId: 'target_b', nodeType: 't', dependsOn: ['src'], inputs: [makeListPort('items')], outputs: [], config: {} }
            ],
            edges: [
                { from: 'src', to: 'target_a', bindings: [{ outputKey: 'out', inputKey: 'items[5]' }] },
                { from: 'src', to: 'target_b', bindings: [{ outputKey: 'out', inputKey: 'items[7]' }] }
            ]
        };

        const result = compactListBindings(definition);

        // Each target starts its own counter at 0
        expect(result.edges[0].bindings[0].inputKey).toBe('items[0]');
        expect(result.edges[1].bindings[0].inputKey).toBe('items[0]');
    });
});

describe('computeInputHandlesByPortKey', () => {
    it('generates handles for connected list ports plus one placeholder', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'src_a', nodeType: 's', dependsOn: [], inputs: [], outputs: [], config: {} },
                { nodeId: 'src_b', nodeType: 's', dependsOn: [], inputs: [], outputs: [], config: {} },
                { nodeId: 'target', nodeType: 't', dependsOn: ['src_a', 'src_b'], inputs: [makeListPort('images')], outputs: [], config: {} }
            ],
            edges: [
                { from: 'src_a', to: 'target', bindings: [{ outputKey: 'image', inputKey: 'images[0]' }] },
                { from: 'src_b', to: 'target', bindings: [{ outputKey: 'image', inputKey: 'images[1]' }] }
            ]
        };

        const result = computeInputHandlesByPortKey(definition, 'target', [makeListPort('images')]);

        // 2 connected + 1 placeholder = 3 handles
        expect(result['images']).toEqual(['images[0]', 'images[1]', 'images[2]']);
    });

    it('generates one placeholder handle for unconnected list port', () => {
        const definition: IDagDefinition = {
            dagId: 'test',
            version: 1,
            status: 'draft',
            nodes: [
                { nodeId: 'target', nodeType: 't', dependsOn: [], inputs: [makeListPort('images')], outputs: [], config: {} }
            ],
            edges: []
        };

        const result = computeInputHandlesByPortKey(definition, 'target', [makeListPort('images')]);

        expect(result['images']).toEqual(['images[0]']);
    });
});
