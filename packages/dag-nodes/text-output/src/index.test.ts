import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { TextOutputNodeDefinition } from './index.js';

function createContext(): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'text-output-1',
            nodeType: 'text-output',
            dependsOn: ['input-1'],
            inputs: [{ key: 'text', type: 'string', required: true }],
            outputs: [{ key: 'text', type: 'string', required: true }],
            config: {}
        },
        nodeManifest: {
            nodeType: 'text-output',
            displayName: 'Text Output',
            category: 'Core',
            inputs: [{ key: 'text', type: 'string', required: true }],
            outputs: [{ key: 'text', type: 'string', required: true }]
        },
        attempt: 1,
        executionPath: [],
        currentTotalCredits: 0
    };
}

describe('TextOutputNodeDefinition', () => {
    it('has correct metadata', () => {
        const node = new TextOutputNodeDefinition();
        expect(node.nodeType).toBe('text-output');
        expect(node.inputs).toHaveLength(1);
        expect(node.outputs).toHaveLength(1);
    });

    it('passes through text input to output', async () => {
        const node = new TextOutputNodeDefinition();
        const result = await node.taskHandler.execute({ text: 'hello' }, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.text).toBe('hello');
        }
    });

    it('returns error when text input is missing', async () => {
        const node = new TextOutputNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext());
        expect(result.ok).toBe(false);
    });

    it('estimates cost as zero', async () => {
        const node = new TextOutputNodeDefinition();
        const result = await node.taskHandler.estimateCost!({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.estimatedCredits).toBe(0);
        }
    });
});
