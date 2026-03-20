import { describe, it, expect } from 'vitest';
import { translateDefinitionToPrompt } from '../adapters/definition-to-prompt-translator.js';
import type { IDagDefinition, IDagNode, INodeConfigObject, TPortPayload } from '@robota-sdk/dag-core';

function makeDefinition(
    overrides: Partial<IDagDefinition> = {}
): IDagDefinition {
    return {
        dagId: 'test-dag',
        version: 1,
        status: 'published',
        nodes: [],
        edges: [],
        ...overrides,
    };
}

function makeNode(
    nodeId: string,
    nodeType: string,
    config: INodeConfigObject = {}
): IDagNode {
    return {
        nodeId,
        nodeType,
        dependsOn: [],
        config,
        inputs: [],
        outputs: [],
    };
}

describe('translateDefinitionToPrompt', () => {
    it('returns error result for empty definition', () => {
        const result = translateDefinitionToPrompt(
            makeDefinition({ nodes: [] }),
            {}
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('ORCHESTRATOR_EMPTY_DEFINITION');
        }
    });

    it('copies primitive config values (string, number, boolean) to inputs', () => {
        const definition = makeDefinition({
            nodes: [
                makeNode('node1', 'TestType', {
                    text: 'hello',
                    count: 42,
                    enabled: true,
                }),
            ],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const nodeInputs = result.value.prompt['node1'].inputs;
        expect(nodeInputs['text']).toBe('hello');
        expect(nodeInputs['count']).toBe(42);
        expect(nodeInputs['enabled']).toBe(true);
    });

    it('copies object config values (nested objects) to inputs', () => {
        const assetConfig = {
            referenceType: 'asset',
            assetId: 'img-001',
        };
        const definition = makeDefinition({
            nodes: [
                makeNode('node1', 'ImageLoader', {
                    asset: assetConfig,
                }),
            ],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const nodeInputs = result.value.prompt['node1'].inputs;
        expect(nodeInputs['asset']).toEqual(assetConfig);
    });

    it('copies array config values to inputs', () => {
        const tagsConfig = ['landscape', 'photo'];
        const definition = makeDefinition({
            nodes: [
                makeNode('node1', 'Tagger', {
                    tags: tagsConfig,
                }),
            ],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const nodeInputs = result.value.prompt['node1'].inputs;
        expect(nodeInputs['tags']).toEqual(tagsConfig);
    });

    it('produces TPromptLink arrays from edge bindings', () => {
        const definition = makeDefinition({
            nodes: [
                makeNode('src', 'Source', {}),
                makeNode('dst', 'Sink', {}),
            ],
            edges: [
                {
                    from: 'src',
                    to: 'dst',
                    bindings: [{ outputKey: 'image', inputKey: 'input_image' }],
                },
            ],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const dstInputs = result.value.prompt['dst'].inputs;
        expect(dstInputs['input_image']).toEqual(['src', 0]);
    });

    it('assigns incremental slot indices for multiple output keys from the same node', () => {
        const definition = makeDefinition({
            nodes: [
                makeNode('src', 'MultiOutput', {}),
                makeNode('dst', 'Sink', {}),
            ],
            edges: [
                {
                    from: 'src',
                    to: 'dst',
                    bindings: [
                        { outputKey: 'image', inputKey: 'in_image' },
                        { outputKey: 'mask', inputKey: 'in_mask' },
                    ],
                },
            ],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const dstInputs = result.value.prompt['dst'].inputs;
        expect(dstInputs['in_image']).toEqual(['src', 0]);
        expect(dstInputs['in_mask']).toEqual(['src', 1]);
    });

    it('input node receives TPortPayload values', () => {
        const definition = makeDefinition({
            nodes: [makeNode('inputNode', 'input', {})],
        });
        const input: TPortPayload = { prompt: 'test prompt', seed: 42 };

        const result = translateDefinitionToPrompt(definition, input);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const nodeInputs = result.value.prompt['inputNode'].inputs;
        expect(nodeInputs['prompt']).toBe('test prompt');
        expect(nodeInputs['seed']).toBe(42);
    });

    it('class_type matches nodeType', () => {
        const definition = makeDefinition({
            nodes: [makeNode('n1', 'KSampler', { steps: 20 })],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.prompt['n1'].class_type).toBe('KSampler');
    });

    it('_meta.title matches nodeId', () => {
        const definition = makeDefinition({
            nodes: [makeNode('myNode', 'TestType', {})],
        });

        const result = translateDefinitionToPrompt(definition, {});
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.prompt['myNode']._meta?.title).toBe('myNode');
    });
});
