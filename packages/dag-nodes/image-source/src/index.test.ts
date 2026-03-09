import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject } from '@robota-sdk/dag-core';
import { ImageSourceNodeDefinition } from './index.js';

function createContext(config: INodeConfigObject = {
    asset: { referenceType: 'uri', uri: 'https://cdn.test/image.png', mediaType: 'image/png' }
}): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'source-1',
            nodeType: 'image-source',
            dependsOn: [],
            inputs: [],
            outputs: [{ key: 'image', type: 'binary', required: true }],
            config
        },
        nodeManifest: {
            nodeType: 'image-source',
            displayName: 'Image Source',
            category: 'Test',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: [],
        currentTotalCostUsd: 0
    };
}

describe('ImageSourceNodeDefinition', () => {
    it('has correct metadata', () => {
        const node = new ImageSourceNodeDefinition();
        expect(node.nodeType).toBe('image-source');
        expect(node.category).toBe('Test');
        expect(node.inputs).toHaveLength(0);
    });

    it('produces binary image from data URI config', async () => {
        const node = new ImageSourceNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            const image = result.value.image as Record<string, unknown>;
            expect(image.kind).toBe('image');
            expect(image.mimeType).toBe('image/png');
        }
    });

    it('uses configured mimeType override', async () => {
        const node = new ImageSourceNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext({
            asset: { referenceType: 'uri', uri: 'https://cdn.test/image.png' },
            mimeType: 'image/jpeg'
        }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            const image = result.value.image as Record<string, unknown>;
            expect(image.mimeType).toBe('image/jpeg');
        }
    });

    it('estimates cost as zero', async () => {
        const node = new ImageSourceNodeDefinition();
        const result = await node.taskHandler.estimateCost!({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.estimatedCostUsd).toBe(0);
        }
    });
});
