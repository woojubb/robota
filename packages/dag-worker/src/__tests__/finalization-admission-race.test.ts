import { expect, it, vi } from 'vitest';
import type { IDagDefinition, IDagRun, IQueueMessage } from '@robota-sdk/dag-core';
import { InMemoryQueuePort, InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { ManualClockPort } from '@robota-sdk/dag-adapters-local/testing';
import { finalizeDagRunIfTerminal } from '../services/dag-run-finalizer.js';
import { TaskOutcomeHandler } from '../services/task-outcome-handler.js';

it('does not finalize while a concurrent completed root still has a ready child to admit', async () => {
  const storage = new InMemoryStoragePort();
  const queue = new InMemoryQueuePort();
  const clock = new ManualClockPort(Date.UTC(2026, 8, 24));
  const definition: IDagDefinition = {
    dagId: 'dag',
    version: 1,
    status: 'published',
    nodes: [
      { nodeId: 'a', nodeType: 'test', dependsOn: [], config: {} },
      { nodeId: 'b', nodeType: 'test', dependsOn: [], config: {} },
      { nodeId: 'child', nodeType: 'test', dependsOn: ['a'], config: {} },
    ],
    edges: [{ from: 'a', to: 'child' }],
  };
  const run: IDagRun = {
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'run',
    logicalDate: clock.nowIso(),
    trigger: 'manual',
    definitionSnapshot: JSON.stringify(definition),
  };
  await storage.createDagRun(run);
  for (const nodeId of ['a', 'b'])
    await storage.createTaskRun({
      taskRunId: nodeId,
      dagRunId: 'run',
      nodeId,
      status: 'running',
      attempt: 1,
      leaseOwner: 'worker',
    });
  const handler = new TaskOutcomeHandler(storage, queue, clock, {
    workerId: 'worker',
    leaseDurationMs: 30000,
    visibilityTimeoutMs: 30000,
    maxAttempts: 1,
    defaultTimeoutMs: 1000,
    retryEnabled: false,
  });
  const message = (nodeId: string): IQueueMessage => ({
    messageId: nodeId,
    dagRunId: 'run',
    taskRunId: nodeId,
    nodeId,
    attempt: 1,
    executionPath: [],
    payload: {},
    createdAt: clock.nowIso(),
  });
  let release!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const commit = storage.commitExecution.bind(storage);
  vi.spyOn(storage, 'commitExecution').mockImplementation(async (runId, mutation) => {
    if (mutation.kind === 'admit' && mutation.taskRun.nodeId === 'child') {
      reached();
      await blocked;
    }
    return commit(runId, mutation);
  });
  const first = handler.handleSuccessPath(message('a'), 'a', run, definition, {});
  await observed;
  try {
    await handler.handleSuccessPath(message('b'), 'b', run, definition, {});
    expect((await storage.getDagRun('run'))?.status).toBe('running');
  } finally {
    release();
    await first;
  }
  expect(
    (await storage.listTaskRunsByDagRunId('run')).find((task) => task.nodeId === 'child')?.status,
  ).toBe('queued');
});

it.each(['{', '{"nodes":[]}'])(
  'rejects malformed finalization topology %s',
  async (definitionSnapshot) => {
    const storage = new InMemoryStoragePort();
    const clock = new ManualClockPort(Date.UTC(2026, 8, 24));
    await storage.createDagRun({
      dagRunId: 'run',
      dagId: 'dag',
      version: 1,
      status: 'running',
      runKey: 'run',
      logicalDate: clock.nowIso(),
      trigger: 'manual',
      definitionSnapshot,
    });
    const result = await finalizeDagRunIfTerminal('run', storage, clock);
    expect(result.ok).toBe(false);
    expect((await storage.getDagRun('run'))?.status).toBe('running');
  },
);

it('can finalize failed branches whose downstream nodes cannot become ready', async () => {
  const storage = new InMemoryStoragePort();
  const clock = new ManualClockPort(Date.UTC(2026, 8, 24));
  const definition: IDagDefinition = {
    dagId: 'dag',
    version: 1,
    status: 'published',
    nodes: [
      { nodeId: 'root', nodeType: 'test', dependsOn: [], config: {} },
      { nodeId: 'child', nodeType: 'test', dependsOn: ['root'], config: {} },
    ],
    edges: [{ from: 'root', to: 'child' }],
  };
  await storage.createDagRun({
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'run',
    logicalDate: clock.nowIso(),
    trigger: 'manual',
    definitionSnapshot: JSON.stringify(definition),
  });
  await storage.createTaskRun({
    taskRunId: 'root',
    dagRunId: 'run',
    nodeId: 'root',
    status: 'failed',
    attempt: 1,
  });
  expect((await finalizeDagRunIfTerminal('run', storage, clock)).ok).toBe(true);
  expect((await storage.getDagRun('run'))?.status).toBe('failed');
});

it('keeps finalization behind a retry reserved with a concurrent task failure', async () => {
  const storage = new InMemoryStoragePort();
  const queue = new InMemoryQueuePort();
  const clock = new ManualClockPort(Date.UTC(2026, 8, 24));
  const definition: IDagDefinition = {
    dagId: 'dag',
    version: 1,
    status: 'published',
    nodes: [
      { nodeId: 'a', nodeType: 'test', dependsOn: [], config: {} },
      { nodeId: 'b', nodeType: 'test', dependsOn: [], config: {} },
    ],
    edges: [],
  };
  const run: IDagRun = {
    dagRunId: 'run',
    dagId: 'dag',
    version: 1,
    status: 'running',
    runKey: 'run',
    logicalDate: clock.nowIso(),
    trigger: 'manual',
    definitionSnapshot: JSON.stringify(definition),
  };
  await storage.createDagRun(run);
  for (const nodeId of ['a', 'b'])
    await storage.createTaskRun({
      taskRunId: nodeId,
      dagRunId: 'run',
      nodeId,
      status: 'running',
      attempt: 1,
      leaseOwner: 'worker',
    });
  const handler = new TaskOutcomeHandler(storage, queue, clock, {
    workerId: 'worker',
    leaseDurationMs: 30000,
    visibilityTimeoutMs: 30000,
    maxAttempts: 3,
    defaultTimeoutMs: 1000,
    retryEnabled: true,
  });
  const message = (nodeId: string): IQueueMessage => ({
    messageId: nodeId,
    dagRunId: 'run',
    taskRunId: nodeId,
    nodeId,
    attempt: 1,
    executionPath: [],
    payload: {},
    createdAt: clock.nowIso(),
  });
  let release!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const commit = storage.commitExecution.bind(storage);
  vi.spyOn(storage, 'commitExecution').mockImplementation(async (runId, mutation) => {
    const result = await commit(runId, mutation);
    if (mutation.kind === 'settle' && mutation.status === 'failed') {
      reached();
      await blocked;
    }
    return result;
  });
  const failure = handler.handleFailurePath(message('a'), 'a', {
    code: 'RETRY_ME',
    category: 'task_execution',
    message: 'retry',
    retryable: true,
  });
  await observed;
  try {
    await handler.handleSuccessPath(message('b'), 'b', run, definition, {});
    expect((await storage.getDagRun('run'))?.status).toBe('running');
    expect(await storage.getTaskRun('a')).toMatchObject({ status: 'queued', attempt: 2 });
  } finally {
    release();
    await failure;
  }
  const retry = await queue.dequeue('worker', 1000);
  expect(retry?.attempt).toBe(2);
  if (!retry) return;
  await storage.updateTaskRunStatus('a', 'running');
  await handler.handleSuccessPath(retry, 'a', run, definition, {});
  expect((await storage.getDagRun('run'))?.status).toBe('success');
});
