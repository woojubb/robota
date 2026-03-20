import { describe, expect, it } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import { TextTemplateNodeDefinition } from './index.js';

function createContext(template = 'Hello, %s!'): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'template-1',
            nodeType: 'text-template',
            dependsOn: [],
            inputs: [{ key: 'text', type: 'string', required: true }],
            outputs: [{ key: 'text', type: 'string', required: true }],
            config: { template }
        },
        nodeManifest: {
            nodeType: 'text-template',
            displayName: 'Text Template',
            category: 'Core',
            inputs: [{ key: 'text', type: 'string', required: true }],
            outputs: [{ key: 'text', type: 'string', required: true }]
        },
        attempt: 1,
        executionPath: [],
        currentTotalCredits: 0
    };
}

describe('TextTemplateNodeDefinition', () => {
    it('has correct metadata', () => {
        const node = new TextTemplateNodeDefinition();
        expect(node.nodeType).toBe('text-template');
        expect(node.category).toBe('Core');
    });

    it('substitutes %s with input text', async () => {
        const node = new TextTemplateNodeDefinition();
        const result = await node.taskHandler.execute(
            { text: 'world' },
            createContext('Hello, %s!')
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.text).toBe('Hello, world!');
        }
    });

    it('preserves literal %%s as %s in output', async () => {
        const node = new TextTemplateNodeDefinition();
        const result = await node.taskHandler.execute(
            { text: 'value' },
            createContext('Use %%s for %s')
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.text).toBe('Use %s for value');
        }
    });

    it('uses default template when none specified', async () => {
        const node = new TextTemplateNodeDefinition();
        const result = await node.taskHandler.execute(
            { text: 'passthrough' },
            createContext('%s')
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.text).toBe('passthrough');
        }
    });

    it('returns error when text input is missing', async () => {
        const node = new TextTemplateNodeDefinition();
        const result = await node.taskHandler.execute({}, createContext());
        expect(result.ok).toBe(false);
    });

    it('validates input rejects missing text', async () => {
        const node = new TextTemplateNodeDefinition();
        const result = await node.taskHandler.validateInput!({}, createContext());
        expect(result.ok).toBe(false);
    });

    it('estimates cost as zero', async () => {
        const node = new TextTemplateNodeDefinition();
        const result = await node.taskHandler.estimateCost!({}, createContext());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.estimatedCredits).toBe(0);
        }
    });
});
