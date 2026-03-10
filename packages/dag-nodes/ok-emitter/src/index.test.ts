import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { OkEmitterNodeDefinition } from './index.js';

function createContext(): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'ok-1',
            nodeType: 'ok-emitter',
            dependsOn: [],
            inputs: [{ key: 'image', type: 'binary', required: true }],
            outputs: [{ key: 'status', type: 'string', required: true }],
            config: {}
        },
        nodeManifest: {
            nodeType: 'ok-emitter',
            displayName: 'OK Emitter',
            category: 'Test',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: [],
        currentTotalCostUsd: 0
    };
}

const VALID_IMAGE_BINARY = {
    kind: 'image',
    mimeType: 'image/png',
    uri: 'data:image/png;base64,iVBORw0KGgo='
};

describe('OkEmitterNodeDefinition', () => {
    it('has correct metadata', () => {
        const node = new OkEmitterNodeDefinition();
        expect(node.nodeType).toBe('ok-emitter');
        expect(node.category).toBe('Test');
    });

    it('emits ok status for valid image binary', async () => {
        const node = new OkEmitterNodeDefinition();
        const result = await node.taskHandler.execute(
            { image: VALID_IMAGE_BINARY },
            createContext()
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.status).toBe('ok');
        }
    });

    it('returns error when image input is missing', async () => {
        const node = new OkEmitterNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext());
        expect(result.ok).toBe(false);
    });

    it('validates input rejects non-image binary', async () => {
        const node = new OkEmitterNodeDefinition();
        const result = await node.taskHandler.validateInput!(
            { image: { kind: 'text', data: 'foo' } },
            createContext()
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_OK_EMITTER_IMAGE_REQUIRED');
        }
    });

    it('validates input accepts valid image binary', async () => {
        const node = new OkEmitterNodeDefinition();
        const result = await node.taskHandler.validateInput!(
            { image: VALID_IMAGE_BINARY },
            createContext()
        );
        expect(result.ok).toBe(true);
    });

    it('estimates cost as zero', async () => {
        const node = new OkEmitterNodeDefinition();
        const result = await node.taskHandler.estimateCost!({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.estimatedCostUsd).toBe(0);
        }
    });
});
