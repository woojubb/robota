import { expect, it } from 'vitest';
import { LifecycleTaskExecutorPort } from '@robota-sdk/dag-core';
import type { IDagDefinition, INodeManifest } from '@robota-sdk/dag-core';
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
  SystemClockPort,
} from '@robota-sdk/dag-adapters-local';
import { WorkerLoopService } from '../services/worker-loop-service.js';

it('admits credits for a direct WorkerLoopService lifecycle executor', async () => {
  const storage = new InMemoryStoragePort();
  const queue = new InMemoryQueuePort();
  const manifest: INodeManifest = {
    nodeType: 'test',
    displayName: 'Test',
    category: 'test',
    inputs: [],
    outputs: [],
  };
  const executor = new LifecycleTaskExecutorPort(
    { getManifest: () => manifest, listManifests: () => [manifest] },
    {
      create: () => ({
        ok: true,
        value: {
          initialize: async () => ({ ok: true, value: undefined }),
          validateInput: async () => ({ ok: true, value: undefined }),
          estimateCost: async () => ({ ok: true, value: { estimatedCredits: 0.4 } }),
          execute: async () => ({ ok: true, value: {} }),
          validateOutput: async () => ({ ok: true, value: undefined }),
          dispose: async () => ({ ok: true, value: undefined }),
        },
      }),
    },
  );
  const definition: IDagDefinition = {
    dagId: 'dag',
    version: 1,
    status: 'published',
    costPolicy: { runCreditLimit: 1, costPolicyVersion: 1 },
    nodes: [{ nodeId: 'node', nodeType: 'test', dependsOn: [], config: {} }],
    edges: [],
  };
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    definitionSnapshot: JSON.stringify(definition),
    runKey: 'run',
    logicalDate: '2026-09-24',
    trigger: 'manual',
  });
  await storage.createTaskRun({
    taskRunId: 'task',
    dagRunId: 'run',
    nodeId: 'node',
    status: 'queued',
    attempt: 1,
  });
  await queue.enqueue({
    messageId: 'message',
    dagRunId: 'run',
    taskRunId: 'task',
    nodeId: 'node',
    attempt: 1,
    executionPath: [],
    payload: {},
    createdAt: '2026-09-24',
  });
  const worker = new WorkerLoopService(
    storage,
    queue,
    new InMemoryLeasePort(),
    executor,
    new SystemClockPort(),
    process.cwd(),
    {
      workerId: 'worker',
      leaseDurationMs: 1000,
      visibilityTimeoutMs: 1000,
      retryEnabled: false,
      maxAttempts: 1,
      defaultTimeoutMs: 1000,
    },
  );
  const result = await worker.processOnce();
  expect(result.ok).toBe(true);
  expect(await storage.getTaskRun('task')).toMatchObject({
    status: 'success',
    estimatedCredits: 0.4,
    totalCredits: 0.4,
  });
  expect((await storage.getTaskRun('task'))?.reservedCredits).toBeUndefined();
});
