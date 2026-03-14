import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject } from '@robota-sdk/dag-core';
import { InputNodeDefinition } from './index.js';

function createContext(config: INodeConfigObject = { text: 'hello' }): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'input-1',
            nodeType: 'input',
            dependsOn: [],
            inputs: [],
            outputs: [{ key: 'text', type: 'string', required: true }],
            config
        },
        nodeManifest: {
            nodeType: 'input',
            displayName: 'Input',
            category: 'Core',
            inputs: [],
            outputs: [{ key: 'text', type: 'string', required: true }]
        },
        attempt: 1,
        executionPath: ['dagId:dag-1', 'dagRunId:run-1', 'nodeId:input-1', 'attempt:1'],
        currentTotalCredits: 0
    };
}

describe('InputNodeDefinition', () => {
    it('has correct metadata', () => {
        const node = new InputNodeDefinition();
        expect(node.nodeType).toBe('input');
        expect(node.displayName).toBe('Input');
        expect(node.category).toBe('Core');
        expect(node.inputs).toHaveLength(0);
        expect(node.outputs).toHaveLength(1);
    });

    it('emits configured text on output', async () => {
        const node = new InputNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext({ text: 'hello world' }));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.text).toBe('hello world');
        }
    });

    it('emits empty string when text is default', async () => {
        const node = new InputNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext({}));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.text).toBe('');
        }
    });

    it('estimates cost as zero', async () => {
        const node = new InputNodeDefinition();
        const result = await node.taskHandler.estimateCost!({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.estimatedCredits).toBe(0);
        }
    });
});
