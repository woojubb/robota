import { describe, expect, it, vi } from 'vitest';
import type {
  IDagDefinition,
  IDagRun,
  IQueueMessage,
  IRunProgressEventReporter,
  ITaskRun,
} from '@robota-sdk/dag-core';
import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
} from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { WorkerLoopService } from '../services/worker-loop-service.js';

function createQueuedTaskFixture() {
  const dagRun: IDagRun = {
    dagRunId: 'dag-run-1',
    dagId: 'dag-1',
    version: 1,
    status: 'running',
    runKey: 'dag-1:run-1',
    logicalDate: '2026-02-14T03:00:00.000Z',
    trigger: 'manual',
    startedAt: '2026-02-14T03:00:00.000Z',
  };

  const taskRun: ITaskRun = {
    taskRunId: 'task-run-1',
    dagRunId: dagRun.dagRunId,
    nodeId: 'entry',
    status: 'queued',
    attempt: 1,
  };

  const message: IQueueMessage = {
    messageId: 'task-run-1:message:1',
    dagRunId: dagRun.dagRunId,
    taskRunId: taskRun.taskRunId,
    nodeId: taskRun.nodeId,
    attempt: 1,
    executionPath: [
      `dagId:${dagRun.dagId}`,
      `dagRunId:${dagRun.dagRunId}`,
      `nodeId:${taskRun.nodeId}`,
      `taskRunId:${taskRun.taskRunId}`,
      'attempt:1',
    ],
    payload: {},
    createdAt: '2026-02-14T03:00:00.000Z',
  };

  return { dagRun, taskRun, message };
}

function createDefinitionForRun(dagRun: IDagRun): IDagDefinition {
  return {
    dagId: dagRun.dagId,
    version: dagRun.version,
    status: 'published',
    nodes: [
      {
        nodeId: 'entry',
        nodeType: 'input',
        dependsOn: [],
        inputs: [],
        outputs: [{ key: 'done', type: 'boolean', required: false }],
        config: {},
      },
    ],
    edges: [],
  };
}

describe('WorkerLoopService', () => {
  const IDLE_WAIT_MS = 50;
  const ENQUEUE_DELAY_MS = 5;

  it('rejects cancellation intervals that would be clamped into rapid polling', () => {
    expect(() => new WorkerLoopService(
      new InMemoryStoragePort(),
      new InMemoryQueuePort(),
      new InMemoryLeasePort(),
      new ScriptedTaskExecutorPort(async () => ({ ok: true, output: {} })),
      new ManualClockPort(Date.UTC(2026, 1, 14)),
      process.cwd(),
      {
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
        visibilityTimeoutMs: 30_000,
        retryEnabled: false,
        maxAttempts: 3,
        defaultTimeoutMs: 50,
        cancellationPollMs: 2_147_483_648,
      },
    )).toThrow(/cancellationPollMs/);
  });

  function createService(
    executor: ScriptedTaskExecutorPort,
    storage: InMemoryStoragePort,
    queue: InMemoryQueuePort,
    lease: InMemoryLeasePort,
    clock: ManualClockPort,
    retryEnabled = false,
    reporter?: IRunProgressEventReporter,
  ): WorkerLoopService {
    return new WorkerLoopService(
      storage,
      queue,
      lease,
      executor,
      clock,
      process.cwd(),
      {
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
        visibilityTimeoutMs: 30_000,
        retryEnabled,
        maxAttempts: 3,
        defaultTimeoutMs: 50,
      },
      reporter,
    );
  }

  it('acknowledges a queued task of a cancelled run without starting or executing it', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();
    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);
    await storage.updateDagRunStatus(dagRun.dagRunId, 'cancelled', clock.nowIso());

    const execute = vi.fn(async () => ({ ok: true as const, output: { done: true } }));
    const publish = vi.fn();
    const service = createService(
      new ScriptedTaskExecutorPort(execute),
      storage,
      queue,
      lease,
      clock,
      false,
      { publish },
    );
    const result = await service.processOnce();

    expect(result).toEqual({
      ok: true,
      value: { processed: true, taskRunId: taskRun.taskRunId, retried: false },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect((await storage.getTaskRun(taskRun.taskRunId))?.status).toBe('cancelled');
    expect((await storage.getDagRun(dagRun.dagRunId))?.status).toBe('cancelled');
    expect(await queue.dequeue('worker-2', 1_000)).toBeUndefined();
  });

  it('does not execute a task when its run is cancelled after the task is claimed', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();
    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const originalListTaskRuns = storage.listTaskRunsByDagRunId.bind(storage);
    vi.spyOn(storage, 'listTaskRunsByDagRunId').mockImplementation(async (dagRunId) => {
      await storage.updateDagRunStatus(dagRunId, 'cancelled', clock.nowIso());
      return originalListTaskRuns(dagRunId);
    });
    const execute = vi.fn(async () => ({ ok: true as const, output: { done: true } }));
    const service = createService(
      new ScriptedTaskExecutorPort(execute),
      storage,
      queue,
      lease,
      clock,
    );
    const result = await service.processOnce();

    expect(result.ok).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect((await storage.getTaskRun(taskRun.taskRunId))?.status).toBe('cancelled');
    expect((await storage.getDagRun(dagRun.dagRunId))?.status).toBe('cancelled');
    expect(await queue.dequeue('worker-2', 1_000)).toBeUndefined();
  });

  it('closes the final status-read race after a persisted cancellation', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();
    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    let finalRead = false;
    let releaseRead: () => void = () => undefined;
    const readHeld = new Promise<void>((resolve) => { releaseRead = resolve; });
    let readEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { readEntered = resolve; });
    const originalList = storage.listTaskRunsByDagRunId.bind(storage);
    vi.spyOn(storage, 'listTaskRunsByDagRunId').mockImplementation(async (runId) => {
      finalRead = true;
      return originalList(runId);
    });
    const originalGet = storage.getDagRun.bind(storage);
    vi.spyOn(storage, 'getDagRun').mockImplementation(async (runId) => {
      if (!finalRead) return originalGet(runId);
      finalRead = false;
      const stale = await originalGet(runId);
      readEntered();
      await readHeld;
      return stale;
    });
    const execute = vi.fn(async () => ({ ok: true as const, output: { done: true } }));
    const worker = createService(new ScriptedTaskExecutorPort(execute), storage, queue, lease, clock);
    const processing = worker.processOnce();
    await entered;
    expect((await storage.commitExecution(dagRun.dagRunId, {
      kind: 'transition-run', expectedStatus: 'running', event: 'CANCEL',
    })).applied).toBe(true);
    worker.notifyRunCancelled(dagRun.dagRunId);
    releaseRead();
    await processing;
    expect(execute).not.toHaveBeenCalled();
    expect((await storage.getDagRun(dagRun.dagRunId))?.status).toBe('cancelled');
    expect((await storage.getTaskRun(taskRun.taskRunId))?.outputSnapshot).toBeUndefined();
  });

  it('aborts only the matching active run and unregisters its completed attempt', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();
    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let attemptSignal: AbortSignal | undefined;
    const execute = vi.fn(async (input) => {
      attemptSignal = input.signal;
      entered();
      await held;
      return { ok: true as const, output: { done: true } };
    });
    const worker = createService(new ScriptedTaskExecutorPort(execute), storage, queue, lease, clock);
    const processing = worker.processOnce();
    await started;
    worker.notifyRunCancelled('unrelated-run');
    expect(attemptSignal?.aborted).toBe(false);
    release();
    await processing;
    worker.notifyRunCancelled(dagRun.dagRunId);
    expect(attemptSignal?.aborted).toBe(false);
  });

  it.each(['success', 'failure', 'reclaimed'] as const)(
    'rejects a late %s outcome after cancellation or ownership replacement',
    async (outcome) => {
      const storage = new InMemoryStoragePort();
      const queue = new InMemoryQueuePort();
      const clock = new ManualClockPort(Date.UTC(2026, 1, 14));
      const { dagRun, taskRun, message } = createQueuedTaskFixture();
      const definition = createDefinitionForRun(dagRun);
      definition.nodes.push({
        nodeId: 'child',
        nodeType: 'input',
        dependsOn: ['entry'],
        config: {},
      });
      definition.edges.push({ from: 'entry', to: 'child' });
      await storage.saveDefinition(definition);
      await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
      await storage.createTaskRun(taskRun);
      await queue.enqueue(message);
      const publish = vi.fn();
      const executor = new ScriptedTaskExecutorPort(async () => {
        if (outcome === 'reclaimed') {
          await storage.incrementTaskAttempt(taskRun.taskRunId);
          await storage.setTaskRunLease(taskRun.taskRunId, 'replacement', '2099-01-01');
        } else {
          await storage.updateDagRunStatus(dagRun.dagRunId, 'cancelled', clock.nowIso());
        }
        return outcome === 'failure'
          ? {
              ok: false,
              error: {
                code: 'TEST_FAILURE',
                category: 'task_execution',
                message: 'failed',
                retryable: true,
              },
            }
          : { ok: true, output: { done: true } };
      });
      await createService(executor, storage, queue, new InMemoryLeasePort(), clock, true, {
        publish,
      }).processOnce();
      const updated = await storage.getTaskRun(taskRun.taskRunId);
      expect(updated?.status).toBe(outcome === 'reclaimed' ? 'running' : 'cancelled');
      expect(updated?.attempt).toBe(outcome === 'reclaimed' ? 2 : 1);
      expect(updated?.outputSnapshot).toBeUndefined();
      expect(await storage.listTaskRunsByDagRunId(dagRun.dagRunId)).toHaveLength(1);
      expect(publish.mock.calls.map(([event]) => event.eventType)).toEqual(['task.started']);
      expect(await queue.dequeue('other', 1000)).toBeUndefined();
    },
  );

  it.each(['success', 'failure'] as const)(
    'blocks new execution when cancellation follows committed %s',
    async (outcome) => {
      const storage = new InMemoryStoragePort();
      const queue = new InMemoryQueuePort();
      const clock = new ManualClockPort(Date.UTC(2026, 1, 14));
      const { dagRun, taskRun, message } = createQueuedTaskFixture();
      const definition = createDefinitionForRun(dagRun);
      definition.nodes.push({
        nodeId: 'child',
        nodeType: 'input',
        dependsOn: ['entry'],
        config: {},
      });
      definition.edges.push({ from: 'entry', to: 'child' });
      await storage.saveDefinition(definition);
      await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
      await storage.createTaskRun(taskRun);
      await queue.enqueue(message);
      const publish = vi.fn((event) => {
        if (event.eventType === 'task.completed' || event.eventType === 'task.failed') {
          // This adapter commits synchronously before its promise resolves.
          void storage.commitExecution(dagRun.dagRunId, {
            kind: 'transition-run',
            expectedStatus: 'running',
            event: 'CANCEL',
          });
        }
      });
      const executor = new ScriptedTaskExecutorPort(async () =>
        outcome === 'success'
          ? { ok: true, output: { done: true } }
          : {
              ok: false,
              error: {
                code: 'TEST_FAILURE',
                category: 'task_execution',
                message: 'failed',
                retryable: true,
              },
            },
      );
      const service = createService(
        executor,
        storage,
        queue,
        new InMemoryLeasePort(),
        clock,
        true,
        { publish },
      );
      const result = await service.processOnce();
      expect(result).toMatchObject({ ok: true, value: { retried: outcome === 'failure' } });
      if (outcome === 'failure') {
        // The retry reservation preceded the failure event's cancellation callback.
        // Its later queue delivery must be settled without a second executor invocation.
        await service.processOnce();
        expect((await storage.getTaskRun(taskRun.taskRunId))?.status).toBe('cancelled');
        expect(
          publish.mock.calls.filter(([event]) => event.eventType === 'task.failed'),
        ).toHaveLength(1);
      }
      expect((await storage.getDagRun(dagRun.dagRunId))?.status).toBe('cancelled');
      expect(await storage.listTaskRunsByDagRunId(dagRun.dagRunId)).toHaveLength(1);
      expect((await storage.getTaskRun(taskRun.taskRunId))?.attempt).toBe(
        outcome === 'failure' ? 2 : 1,
      );
      expect(await queue.dequeue('other', 1000)).toBeUndefined();
    },
  );

  it('keeps cancellation terminal when it arrives during the task lease claim', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();
    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);
    const setLease = storage.setTaskRunLease.bind(storage);
    vi.spyOn(storage, 'setTaskRunLease').mockImplementationOnce(async (...args) => {
      await storage.commitExecution(dagRun.dagRunId, {
        kind: 'transition-run',
        expectedStatus: 'running',
        event: 'CANCEL',
      });
      await setLease(...args);
    });
    const execute = vi.fn(async () => ({ ok: true as const, output: { done: true } }));
    await createService(
      new ScriptedTaskExecutorPort(execute),
      storage,
      queue,
      new InMemoryLeasePort(),
      clock,
    ).processOnce();
    expect(execute).not.toHaveBeenCalled();
    expect((await storage.getDagRun(dagRun.dagRunId))?.status).toBe('cancelled');
    expect(await storage.getTaskRun(taskRun.taskRunId)).toMatchObject({
      status: 'cancelled',
      leaseOwner: undefined,
      leaseUntil: undefined,
    });
    expect(await queue.dequeue('other', 1000)).toBeUndefined();
  });

  it('marks task success and acknowledges message', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    let observedExecutionRoot: string | undefined;
    const executor = new ScriptedTaskExecutorPort(async (input) => {
      observedExecutionRoot = input.executionRoot;
      return { ok: true, output: { done: true } };
    });

    const service = createService(executor, storage, queue, lease, clock);
    const result = await service.processOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.retried).toBe(false);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('success');
    const run = await storage.getDagRun(dagRun.dagRunId);
    expect(run?.status).toBe('success');
    expect(observedExecutionRoot).toBe(process.cwd());

    const next = await queue.dequeue('worker-2', 1_000);
    expect(next).toBeUndefined();
  });

  it('waits for a queued task during idle wait before returning unprocessed', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));

    const service = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
      workerId: 'worker-1',
      leaseDurationMs: 30_000,
      visibilityTimeoutMs: 30_000,
      retryEnabled: false,
      maxAttempts: 3,
      defaultTimeoutMs: 50,
      idleWaitMs: IDLE_WAIT_MS,
    });

    const pendingProcess = service.processOnce();
    await new Promise((resolve) => setTimeout(resolve, ENQUEUE_DELAY_MS));
    await queue.enqueue(message);

    const result = await pendingProcess;
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.processed).toBe(true);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('success');
  });

  it('keeps failed status when retry policy is disabled even with retryable error', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_FAILED',
        category: 'task_execution',
        message: 'Transient failure',
        retryable: true,
      },
    }));

    const service = createService(executor, storage, queue, lease, clock);
    const result = await service.processOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.retried).toBe(false);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('failed');
    expect(updated?.attempt).toBe(1);

    const retriedMessage = await queue.dequeue('worker-2', 1_000);
    expect(retriedMessage).toBeUndefined();
  });

  it('re-enqueues task when retry policy is enabled and error is retryable', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_FAILED',
        category: 'task_execution',
        message: 'Transient failure',
        retryable: true,
      },
    }));

    const service = createService(executor, storage, queue, lease, clock, true);
    const result = await service.processOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.retried).toBe(true);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('queued');
    expect(updated?.attempt).toBe(2);

    const retriedMessage = await queue.dequeue('worker-2', 1_000);
    expect(retriedMessage?.attempt).toBe(2);
  });

  it('keeps failed status when error is non-retryable', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_HARD_FAIL',
        category: 'task_execution',
        message: 'Hard failure',
        retryable: false,
      },
    }));

    const service = createService(executor, storage, queue, lease, clock);
    const result = await service.processOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.retried).toBe(false);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('failed');
    expect(updated?.attempt).toBe(1);

    const run = await storage.getDagRun(dagRun.dagRunId);
    expect(run?.status).toBe('failed');
  });

  it('transitions to terminal failure after retry attempts are exhausted', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_FAILED',
        category: 'task_execution',
        message: 'Transient failure',
        retryable: true,
      },
    }));

    const service = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
      workerId: 'worker-1',
      leaseDurationMs: 30_000,
      visibilityTimeoutMs: 30_000,
      retryEnabled: true,
      maxAttempts: 2,
      defaultTimeoutMs: 50,
    });

    const first = await service.processOnce();
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.retried).toBe(true);

    const second = await service.processOnce();
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.retried).toBe(false);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('failed');
    expect(updated?.attempt).toBe(2);

    const run = await storage.getDagRun(dagRun.dagRunId);
    expect(run?.status).toBe('failed');
  });

  it("does not let a node's configured timeoutMs touch a same-named input field, across a retry", async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    // A run input field that happens to share the reserved name, on a node that also configures
    // its own timeoutMs. The worker resolves ITS attempt timeout from the node definition (see
    // resolveTimeoutMs), never from the payload, so this field must survive untouched — including
    // through a retry, which replays the same payload.
    const messageWithUserField: IQueueMessage = {
      ...message,
      payload: { timeoutMs: 'user-value' },
    };

    const definition = createDefinitionForRun(dagRun);
    definition.nodes[0] = { ...definition.nodes[0], timeoutMs: 5_000 };
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(messageWithUserField);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_FAILED',
        category: 'task_execution',
        message: 'Transient failure',
        retryable: true,
      },
    }));

    const service = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
      workerId: 'worker-1',
      leaseDurationMs: 30_000,
      visibilityTimeoutMs: 30_000,
      retryEnabled: true,
      maxAttempts: 2,
      defaultTimeoutMs: 50,
    });

    const first = await service.processOnce();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.retried).toBe(true);

    const retryMessage = await queue.dequeue('worker-1', 1_000);
    expect(retryMessage?.attempt).toBe(2);
    expect(retryMessage?.payload).toEqual({ timeoutMs: 'user-value' });
  });

  it('reassigns processing after lease becomes available', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    await lease.acquire(`taskRun:${taskRun.taskRunId}`, 'worker-lock', 30_000);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));

    const worker = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
      workerId: 'worker-2',
      leaseDurationMs: 30_000,
      visibilityTimeoutMs: 30_000,
      retryEnabled: false,
      maxAttempts: 1,
      defaultTimeoutMs: 50,
    });

    const firstAttempt = await worker.processOnce();
    expect(firstAttempt.ok).toBe(true);
    if (!firstAttempt.ok) {
      return;
    }
    expect(firstAttempt.value.processed).toBe(false);

    await lease.release(`taskRun:${taskRun.taskRunId}`, 'worker-lock');

    const secondAttempt = await worker.processOnce();
    expect(secondAttempt.ok).toBe(true);
    if (!secondAttempt.ok) {
      return;
    }
    expect(secondAttempt.value.processed).toBe(true);

    const updated = await storage.getTaskRun(taskRun.taskRunId);
    expect(updated?.status).toBe('success');
  });

  it('sends failed message to dead letter queue when enabled', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const deadLetterQueue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: false,
      error: {
        code: 'DAG_TASK_EXECUTION_HARD_FAIL',
        category: 'task_execution',
        message: 'Hard failure',
        retryable: false,
      },
    }));

    const service = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
      workerId: 'worker-1',
      leaseDurationMs: 30_000,
      visibilityTimeoutMs: 30_000,
      retryEnabled: false,
      deadLetterEnabled: true,
      deadLetterQueue,
      maxAttempts: 1,
      defaultTimeoutMs: 50,
    });

    const result = await service.processOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const deadLetterMessage = await deadLetterQueue.dequeue('dlq-reader', 1_000);
    expect(deadLetterMessage?.taskRunId).toBe(taskRun.taskRunId);
    expect(deadLetterMessage?.payload.dlqReasonCode).toBe('DAG_TASK_EXECUTION_HARD_FAIL');
  });

  it('dispatches downstream ready node after upstream success', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition: IDagDefinition = {
      dagId: dagRun.dagId,
      version: dagRun.version,
      status: 'published',
      nodes: [
        {
          nodeId: 'entry',
          nodeType: 'input',
          dependsOn: [],
          inputs: [],
          outputs: [{ key: 'nextInput', type: 'string', required: false }],
          config: {},
        },
        {
          nodeId: 'next',
          nodeType: 'processor',
          dependsOn: ['entry'],
          inputs: [{ key: 'nextInput', type: 'string', required: false }],
          outputs: [{ key: 'done', type: 'boolean', required: false }],
          config: {},
        },
      ],
      edges: [
        {
          from: 'entry',
          to: 'next',
          bindings: [{ outputKey: 'nextInput', inputKey: 'nextInput' }],
        },
      ],
    };
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { nextInput: 'ok' },
    }));
    const service = createService(executor, storage, queue, lease, clock);

    const first = await service.processOnce();
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const nextTaskRun = (await storage.listTaskRunsByDagRunId(dagRun.dagRunId)).find(
      (candidate) => candidate.nodeId === 'next',
    );
    expect(nextTaskRun?.status).toBe('queued');

    const firstRunState = await storage.getDagRun(dagRun.dagRunId);
    expect(firstRunState?.status).toBe('running');

    const second = await service.processOnce();
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }

    const finalRun = await storage.getDagRun(dagRun.dagRunId);
    expect(finalRun?.status).toBe('success');
  });

  it("does not let a downstream node's configured timeoutMs leak onto its dispatched payload", async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition: IDagDefinition = {
      dagId: dagRun.dagId,
      version: dagRun.version,
      status: 'published',
      nodes: [
        {
          nodeId: 'entry',
          nodeType: 'input',
          dependsOn: [],
          inputs: [],
          outputs: [{ key: 'nextInput', type: 'string', required: false }],
          config: {},
        },
        {
          nodeId: 'next',
          nodeType: 'processor',
          dependsOn: ['entry'],
          inputs: [{ key: 'nextInput', type: 'string', required: false }],
          outputs: [{ key: 'done', type: 'boolean', required: false }],
          config: {},
          timeoutMs: 3_000,
        },
      ],
      edges: [
        {
          from: 'entry',
          to: 'next',
          bindings: [{ outputKey: 'nextInput', inputKey: 'nextInput' }],
        },
      ],
    };
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { nextInput: 'ok' },
    }));
    const service = createService(executor, storage, queue, lease, clock);

    const first = await service.processOnce();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const dispatched = await queue.dequeue('worker-1', 1_000);
    expect(dispatched?.nodeId).toBe('next');
    // The downstream node's own timeoutMs is a worker-side execution concern, resolved from the
    // claimed node definition at execution time; it must never appear as an ordinary payload
    // field alongside the real bound input.
    expect(dispatched?.payload).toEqual({ nextInput: 'ok' });
  });

  it('finalizes DAG as success when downstream tasks are upstream_failed', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition: IDagDefinition = {
      dagId: dagRun.dagId,
      version: dagRun.version,
      status: 'published',
      nodes: [
        {
          nodeId: 'entry',
          nodeType: 'input',
          dependsOn: [],
          inputs: [],
          outputs: [{ key: 'done', type: 'boolean', required: false }],
          config: {},
        },
        {
          nodeId: 'downstream',
          nodeType: 'processor',
          dependsOn: ['entry'],
          inputs: [],
          outputs: [],
          config: {},
        },
      ],
      edges: [],
    };
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await storage.createTaskRun({
      taskRunId: 'task-run-downstream',
      dagRunId: dagRun.dagRunId,
      nodeId: 'downstream',
      status: 'upstream_failed',
      attempt: 1,
    });
    await queue.enqueue(message);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));

    const service = createService(executor, storage, queue, lease, clock);
    const result = await service.processOnce();

    expect(result.ok).toBe(true);

    const run = await storage.getDagRun(dagRun.dagRunId);
    expect(run?.status).toBe('success');
  });

  it('returns processed false without error when lease is held by another worker', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const lease = new InMemoryLeasePort();
    const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));
    const { dagRun, taskRun, message } = createQueuedTaskFixture();

    const definition = createDefinitionForRun(dagRun);
    await storage.saveDefinition(definition);
    await storage.createDagRun({ ...dagRun, definitionSnapshot: JSON.stringify(definition) });
    await storage.createTaskRun(taskRun);
    await queue.enqueue(message);

    await lease.acquire(`taskRun:${taskRun.taskRunId}`, 'other-worker', 60_000);

    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));

    const worker = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
      workerId: 'worker-2',
      leaseDurationMs: 30_000,
      visibilityTimeoutMs: 30_000,
      retryEnabled: false,
      maxAttempts: 1,
      defaultTimeoutMs: 50,
    });

    const result = await worker.processOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.processed).toBe(false);
  });
});
