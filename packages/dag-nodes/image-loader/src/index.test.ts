import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { ImageLoaderNodeDefinition } from './index.js';

function createContext(): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'loader-1',
            nodeType: 'image-loader',
            dependsOn: [],
            inputs: [{ key: 'asset', type: 'object', required: true }],
            outputs: [{ key: 'image', type: 'binary', required: true }],
            config: {}
        },
        nodeManifest: {
            nodeType: 'image-loader',
            displayName: 'Image Loader',
            category: 'Media',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: [],
        currentTotalCostUsd: 0
    };
}

describe('ImageLoaderNodeDefinition', () => {
    it('has correct metadata', () => {
        const node = new ImageLoaderNodeDefinition();
        expect(node.nodeType).toBe('image-loader');
        expect(node.category).toBe('Media');
    });

    it('converts media reference to binary image output', async () => {
        const node = new ImageLoaderNodeDefinition();
        const result = await node.taskHandler.execute(
            { asset: { referenceType: 'uri', uri: 'https://cdn.test/image.png', mediaType: 'image/png' } },
            createContext()
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            const image = result.value.image as Record<string, unknown>;
            expect(image.kind).toBe('image');
            expect(image.mimeType).toBe('image/png');
        }
    });

    it('returns error when asset input is missing', async () => {
        const node = new ImageLoaderNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext());
        expect(result.ok).toBe(false);
    });

    it('estimates cost as zero', async () => {
        const node = new ImageLoaderNodeDefinition();
        const result = await node.taskHandler.estimateCost!({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.estimatedCostUsd).toBe(0);
        }
    });
});
