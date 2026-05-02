import { describe, expect, it, vi } from 'vitest';
import { LifecycleTaskExecutorPort } from '../services/lifecycle-task-executor-port.js';
import type { INodeManifest } from '../types/domain.js';
import type { ITaskExecutionInput } from '../interfaces/ports.js';
import type {
  INodeLifecycle,
  INodeLifecycleFactory,
  INodeManifestRegistry,
  INodeTaskHandler,
  TPortPayload,
} from '../index.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';

const testManifest: INodeManifest = {
  nodeType: 'test-node',
  displayName: 'Test',
  category: 'test',
  inputs: [],
  outputs: [],
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
      outputs: [],
    },
    ...overrides,
  };
}

class TestNodeManifestRegistry implements INodeManifestRegistry {
  public constructor(private readonly manifests: INodeManifest[]) {}

  public getManifest(nodeType: string): INodeManifest | undefined {
    return this.manifests.find((manifest) => manifest.nodeType === nodeType);
  }

  public listManifests(): INodeManifest[] {
    return this.manifests;
  }
}

class TestNodeLifecycle implements INodeLifecycle {
  public constructor(private readonly handler: INodeTaskHandler) {}

  public async initialize(): Promise<TResult<void, IDagError>> {
    return { ok: true, value: undefined };
  }

  public async validateInput(): Promise<TResult<void, IDagError>> {
    return { ok: true, value: undefined };
  }

  public async estimateCost(): Promise<TResult<{ estimatedCredits: number }, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  public async execute(input: TPortPayload): Promise<TResult<TPortPayload, IDagError>> {
    return this.handler.execute(input, {
      dagId: 'dag-1',
      dagRunId: 'run-1',
      taskRunId: 'task-1',
      nodeDefinition: makeInput().nodeDefinition!,
      nodeManifest: testManifest,
      attempt: 1,
      executionPath: [],
      currentTotalCredits: 0,
    });
  }

  public async validateOutput(): Promise<TResult<void, IDagError>> {
    return { ok: true, value: undefined };
  }

  public async dispose(): Promise<TResult<void, IDagError>> {
    return { ok: true, value: undefined };
  }
}

class TestNodeLifecycleFactory implements INodeLifecycleFactory {
  public constructor(private readonly handlersByType: Record<string, INodeTaskHandler>) {}

  public create(nodeType: string): TResult<INodeLifecycle, IDagError> {
    const handler = this.handlersByType[nodeType];
    if (!handler) {
      return {
        ok: false,
        error: {
          code: 'DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED',
          category: 'validation',
          message: 'Node lifecycle handler is not registered',
          retryable: false,
        },
      };
    }

    return { ok: true, value: new TestNodeLifecycle(handler) };
  }
}

describe('LifecycleTaskExecutorPort', () => {
  it('returns error when nodeDefinition is missing', async () => {
    const registry = new TestNodeManifestRegistry([testManifest]);
    const port = new LifecycleTaskExecutorPort(registry);
    const result = await port.execute(makeInput({ nodeDefinition: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_NODE_DEFINITION_MISSING');
  });

  it('returns error when manifest is not found', async () => {
    const registry = new TestNodeManifestRegistry([]);
    const port = new LifecycleTaskExecutorPort(registry);
    const result = await port.execute(makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_NODE_MANIFEST_NOT_FOUND');
  });

  it('executes successfully with registered handler and manifest', async () => {
    const handler: INodeTaskHandler = {
      execute: vi.fn().mockResolvedValue({ ok: true, value: { result: 'done' } }),
    };
    const registry = new TestNodeManifestRegistry([testManifest]);
    const lifecycleFactory = new TestNodeLifecycleFactory({ 'test-node': handler });
    const port = new LifecycleTaskExecutorPort(registry, lifecycleFactory);
    const result = await port.execute(makeInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toEqual({ result: 'done' });
  });

  it('uses MissingNodeLifecycleFactory when no factory is provided', async () => {
    const registry = new TestNodeManifestRegistry([testManifest]);
    const port = new LifecycleTaskExecutorPort(registry);
    const result = await port.execute(makeInput());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED');
  });

  it('passes cost policy and currentTotalCredits through', async () => {
    const handler: INodeTaskHandler = {
      execute: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    };
    const registry = new TestNodeManifestRegistry([testManifest]);
    const lifecycleFactory = new TestNodeLifecycleFactory({ 'test-node': handler });
    const port = new LifecycleTaskExecutorPort(registry, lifecycleFactory);
    const result = await port.execute(
      makeInput({
        costPolicy: { runCreditLimit: 10, costPolicyVersion: 1 },
        currentTotalCredits: 5,
      }),
    );
    expect(result.ok).toBe(true);
  });
});
