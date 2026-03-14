import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AbstractNodeDefinition } from '../lifecycle/abstract-node-definition.js';
import type {
    TPortPayload, INodeExecutionContext, ICostEstimate,
    IDagError, TResult, IPortDefinition, INodeConfigObject
} from '@robota-sdk/dag-core';

const TestSchema = z.object({
    prompt: z.string(),
    temperature: z.number().optional()
});

class TestNodeDefinition extends AbstractNodeDefinition<typeof TestSchema> {
    public readonly nodeType = 'test-node';
    public readonly displayName = 'Test Node';
    public readonly category = 'test';
    public readonly inputs: IPortDefinition[] = [];
    public readonly outputs: IPortDefinition[] = [];
    public readonly configSchemaDefinition = TestSchema;

    public constructor() {
        super();
    }

    public async estimateCostWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        _config: z.output<typeof TestSchema>
    ): Promise<TResult<ICostEstimate, IDagError>> {
        return { ok: true, value: { estimatedCostUsd: 0.01 } };
    }

    protected async executeWithConfig(
        _input: TPortPayload,
        _context: INodeExecutionContext,
        config: z.output<typeof TestSchema>
    ): Promise<TResult<TPortPayload, IDagError>> {
        return { ok: true, value: { response: `echo: ${config.prompt}` } };
    }
}

function makeContext(config: INodeConfigObject = { prompt: 'hello' }): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'node-1',
            nodeType: 'test-node',
            dependsOn: [],
            config,
            inputs: [],
            outputs: []
        },
        nodeManifest: {
            nodeType: 'test-node',
            displayName: 'Test Node',
            category: 'test',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: ['dag-1', 'run-1', 'node-1'],
        currentTotalCostUsd: 0
    };
}

describe('AbstractNodeDefinition', () => {
    it('taskHandler.execute delegates to executeWithConfig with parsed config', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext({ prompt: 'world' });
        const result = await node.taskHandler.execute({}, ctx);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual({ response: 'echo: world' });
    });

    it('returns config validation error for invalid config', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext({ temperature: 0.5 }); // missing required 'prompt'
        const result = await node.taskHandler.execute({}, ctx);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID');
    });

    it('taskHandler.initialize succeeds with valid config (default implementation)', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext();
        const result = await node.taskHandler.initialize!(ctx);
        expect(result.ok).toBe(true);
    });

    it('taskHandler.initialize fails with invalid config', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext({});
        const result = await node.taskHandler.initialize!(ctx);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_CONFIG_SCHEMA_INVALID');
    });

    it('taskHandler.validateInput succeeds with default implementation', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext();
        const result = await node.taskHandler.validateInput!({}, ctx);
        expect(result.ok).toBe(true);
    });

    it('taskHandler.estimateCost delegates to estimateCostWithConfig', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext();
        const result = await node.taskHandler.estimateCost!({}, ctx);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.estimatedCostUsd).toBe(0.01);
    });

    it('taskHandler.validateOutput succeeds with default implementation', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext();
        const result = await node.taskHandler.validateOutput!({ response: 'test' }, ctx);
        expect(result.ok).toBe(true);
    });

    it('taskHandler.dispose succeeds with default implementation', async () => {
        const node = new TestNodeDefinition();
        const ctx = makeContext();
        const result = await node.taskHandler.dispose!(ctx);
        expect(result.ok).toBe(true);
    });
});
