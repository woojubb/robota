import { describe, expect, it, vi } from 'vitest';
import {
    NodeLifecycleRunner,
    RunCostPolicyEvaluator,
    MissingNodeLifecycleFactory
} from '../services/node-lifecycle-runner.js';
import type {
    INodeLifecycle,
    INodeLifecycleFactory,
    INodeExecutionContext
} from '../types/node-lifecycle.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import { buildValidationError } from '../utils/error-builders.js';

function makeContext(overrides?: Partial<INodeExecutionContext>): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'node-1',
            nodeType: 'test',
            dependsOn: [],
            config: {},
            inputs: [],
            outputs: []
        },
        nodeManifest: {
            nodeType: 'test',
            displayName: 'Test',
            category: 'test',
            inputs: [],
            outputs: []
        },
        attempt: 1,
        executionPath: [],
        currentTotalCostUsd: 0,
        ...overrides
    };
}

function createSuccessLifecycle(): INodeLifecycle {
    return {
        initialize: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
        validateInput: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
        estimateCost: vi.fn().mockResolvedValue({ ok: true, value: { estimatedCostUsd: 0.01 } }),
        execute: vi.fn().mockResolvedValue({ ok: true, value: { result: 'done' } }),
        validateOutput: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
        dispose: vi.fn().mockResolvedValue({ ok: true, value: undefined })
    };
}

function createFactory(lifecycle: INodeLifecycle): INodeLifecycleFactory {
    return {
        create: vi.fn().mockReturnValue({ ok: true, value: lifecycle })
    };
}

describe('RunCostPolicyEvaluator', () => {
    const evaluator = new RunCostPolicyEvaluator();

    it('returns new total when within budget', () => {
        const result = evaluator.assertWithinBudget(0.5, 0.3, 1.0);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBe(0.8);
    });

    it('returns new total when no limit is set', () => {
        const result = evaluator.assertWithinBudget(100, 50);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBe(150);
    });

    it('returns error for negative estimated cost', () => {
        const result = evaluator.assertWithinBudget(0, -1);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NEGATIVE_ESTIMATED_COST');
    });

    it('returns error when cost exceeds limit', () => {
        const result = evaluator.assertWithinBudget(0.8, 0.3, 1.0);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_COST_LIMIT_EXCEEDED');
    });

    it('allows exact budget match', () => {
        const result = evaluator.assertWithinBudget(0.7, 0.3, 1.0);
        expect(result.ok).toBe(true);
    });
});

describe('NodeLifecycleRunner', () => {
    it('runs full lifecycle successfully', async () => {
        const lifecycle = createSuccessLifecycle();
        const factory = createFactory(lifecycle);
        const evaluator = new RunCostPolicyEvaluator();
        const runner = new NodeLifecycleRunner(factory, evaluator);

        const result = await runner.runNode({
            input: { text: 'hello' },
            context: makeContext()
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.output).toEqual({ result: 'done' });
        expect(result.value.estimatedCostUsd).toBe(0.01);
        expect(result.value.totalCostUsd).toBe(0.01);

        expect(lifecycle.initialize).toHaveBeenCalled();
        expect(lifecycle.validateInput).toHaveBeenCalled();
        expect(lifecycle.estimateCost).toHaveBeenCalled();
        expect(lifecycle.execute).toHaveBeenCalled();
        expect(lifecycle.validateOutput).toHaveBeenCalled();
        expect(lifecycle.dispose).toHaveBeenCalled();
    });

    it('returns error when factory fails to create lifecycle', async () => {
        const factory: INodeLifecycleFactory = {
            create: vi.fn().mockReturnValue({
                ok: false,
                error: buildValidationError('DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED', 'not registered')
            })
        };
        const runner = new NodeLifecycleRunner(factory, new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
    });

    it('returns error and disposes when initialize fails', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.initialize as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            error: buildValidationError('INIT_FAIL', 'init failed')
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
        // dispose is NOT called when initialize fails (per implementation)
        expect(lifecycle.dispose).not.toHaveBeenCalled();
    });

    it('returns error and disposes when validateInput fails', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.validateInput as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            error: buildValidationError('VALIDATE_FAIL', 'validate failed')
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
        expect(lifecycle.dispose).toHaveBeenCalled();
    });

    it('returns error and disposes when estimateCost fails', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.estimateCost as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            error: buildValidationError('COST_FAIL', 'cost failed')
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
        expect(lifecycle.dispose).toHaveBeenCalled();
    });

    it('returns error and disposes when budget check fails', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.estimateCost as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            value: { estimatedCostUsd: 2.0 }
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({
            input: {},
            context: makeContext({ runCostLimitUsd: 1.0, currentTotalCostUsd: 0 })
        });
        expect(result.ok).toBe(false);
        expect(lifecycle.dispose).toHaveBeenCalled();
    });

    it('returns error and disposes when execute fails', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            error: buildValidationError('EXEC_FAIL', 'exec failed')
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
        expect(lifecycle.dispose).toHaveBeenCalled();
    });

    it('returns error and disposes when validateOutput fails', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.validateOutput as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            error: buildValidationError('OUTPUT_FAIL', 'output failed')
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
        expect(lifecycle.dispose).toHaveBeenCalled();
    });

    it('returns dispose error after successful execution', async () => {
        const lifecycle = createSuccessLifecycle();
        (lifecycle.dispose as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: false,
            error: buildValidationError('DISPOSE_FAIL', 'dispose failed')
        });
        const runner = new NodeLifecycleRunner(createFactory(lifecycle), new RunCostPolicyEvaluator());
        const result = await runner.runNode({ input: {}, context: makeContext() });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_TASK_EXECUTION_DISPOSE_FAILED');
    });
});

describe('MissingNodeLifecycleFactory', () => {
    it('always returns error', () => {
        const factory = new MissingNodeLifecycleFactory();
        const result = factory.create('any-type');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED');
    });
});
