import { describe, expect, it, vi } from 'vitest';
import { LifecycleTaskExecutorPort } from '../services/lifecycle-task-executor-port.js';
import { StaticNodeManifestRegistry, createStaticNodeLifecycleFactory } from '@robota-sdk/dag-node';
import type { INodeManifest } from '../types/domain.js';
import type { ITaskExecutionInput } from '../interfaces/ports.js';
import type { INodeLifecycleFactory, INodeTaskHandler } from '../types/node-lifecycle.js';

const testManifest: INodeManifest = {
    nodeType: 'test-node',
    displayName: 'Test',
    category: 'test',
    inputs: [],
    outputs: []
};

function makeInput(overrides?: Partial<ITaskExecutionInput>): ITaskExecutionInput {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeId: 'node-1',
        attempt: 1,
        executionPath: [],
        input: {},
        nodeDefinition: {
            nodeId: 'node-1',
            nodeType: 'test-node',
            dependsOn: [],
            config: {},
            inputs: [],
            outputs: []
        },
        ...overrides
    };
}

describe('LifecycleTaskExecutorPort', () => {
    it('returns error when nodeDefinition is missing', async () => {
        const registry = new StaticNodeManifestRegistry([testManifest]);
        const port = new LifecycleTaskExecutorPort(registry);
        const result = await port.execute(makeInput({ nodeDefinition: undefined }));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_DEFINITION_MISSING');
    });

    it('returns error when manifest is not found', async () => {
        const registry = new StaticNodeManifestRegistry([]);
        const port = new LifecycleTaskExecutorPort(registry);
        const result = await port.execute(makeInput());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_MANIFEST_NOT_FOUND');
    });

    it('executes successfully with registered handler and manifest', async () => {
        const handler: INodeTaskHandler = {
            execute: vi.fn().mockResolvedValue({ ok: true, value: { result: 'done' } })
        };
        const registry = new StaticNodeManifestRegistry([testManifest]);
        const lifecycleFactory = createStaticNodeLifecycleFactory({ 'test-node': handler });
        const port = new LifecycleTaskExecutorPort(registry, lifecycleFactory);
        const result = await port.execute(makeInput());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.output).toEqual({ result: 'done' });
    });

    it('uses MissingNodeLifecycleFactory when no factory is provided', async () => {
        const registry = new StaticNodeManifestRegistry([testManifest]);
        const port = new LifecycleTaskExecutorPort(registry);
        const result = await port.execute(makeInput());
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED');
    });

    it('passes cost policy and currentTotalCostUsd through', async () => {
        const handler: INodeTaskHandler = {
            execute: vi.fn().mockResolvedValue({ ok: true, value: {} })
        };
        const registry = new StaticNodeManifestRegistry([testManifest]);
        const lifecycleFactory = createStaticNodeLifecycleFactory({ 'test-node': handler });
        const port = new LifecycleTaskExecutorPort(registry, lifecycleFactory);
        const result = await port.execute(makeInput({
            costPolicy: { runCostLimitUsd: 10, costCurrency: 'USD', costPolicyVersion: 1 },
            currentTotalCostUsd: 5
        }));
        expect(result.ok).toBe(true);
    });
});
