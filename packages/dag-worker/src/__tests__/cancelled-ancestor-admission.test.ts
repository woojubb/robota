import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IDagDefinition, IDagRun, IQueueMessage, IStoragePort, ITaskRun } from '@robota-sdk/dag-core';
import { FileStoragePort, InMemoryLeasePort, InMemoryQueuePort } from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { SqliteStorageAdapter } from '@robota-sdk/dag-adapters-sqlite';
import { WorkerLoopService } from '../services/worker-loop-service.js';

/**
 * Persisted composite child run ancestry (`IDagRun.lineage`: rootRunId, parentRunId,
 * depth) so a restarted or separate-process worker can still enforce composite depth/recursion
 * limits. But admission (`cancelIfRunCancelled`) only ever read the task's own run status. If the
 * root of a composite tree is committed `cancelled` while a descendant run still has a queued
 * task — because that descendant's own cancellation has not (yet, or ever, in another process)
 * been committed — a worker picking that message up must not still hand it to the executor.
 */
describe('WorkerLoopService refuses admission when a persisted ancestor run is cancelled', () => {
  const dagId = 'composite-child';

  function definition(): IDagDefinition {
    return {
      dagId,
      version: 1,
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

  function run(
    dagRunId: string,
    status: IDagRun['status'],
    lineage?: IDagRun['lineage'],
  ): IDagRun {
    return {
      dagRunId,
      dagId,
      version: 1,
      status,
      runKey: `${dagRunId}:run-key`,
      logicalDate: '2026-02-14T03:00:00.000Z',
      trigger: 'manual',
      startedAt: '2026-02-14T03:00:00.000Z',
      definitionSnapshot: JSON.stringify(definition()),
      ...(lineage ? { lineage } : {}),
    };
  }

  function task(taskRunId: string, dagRunId: string): ITaskRun {
    return { taskRunId, dagRunId, nodeId: 'entry', status: 'queued', attempt: 1 };
  }

  function message(dagRun: IDagRun, taskRun: ITaskRun): IQueueMessage {
    return {
      messageId: `${taskRun.taskRunId}:message:1`,
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
  }

  function buildWorker(storage: IStoragePort, queue: InMemoryQueuePort, executed: unknown[]) {
    return new WorkerLoopService(
      storage,
      queue,
      new InMemoryLeasePort(),
      new ScriptedTaskExecutorPort(async (input) => {
        executed.push(input.input);
        return { ok: true as const, output: { done: true } };
      }),
      new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0)),
      process.cwd(),
      {
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
        visibilityTimeoutMs: 30_000,
        retryEnabled: false,
        maxAttempts: 3,
        defaultTimeoutMs: 50,
      },
    );
  }

  describe.each([
    {
      name: 'SQLite',
      makeStorage: async (): Promise<{ storage: IStoragePort; cleanup: () => Promise<void> }> => {
        const dir = await mkdtemp(path.join(tmpdir(), 'dag-cancelled-ancestor-sqlite-'));
        const storage = new SqliteStorageAdapter(path.join(dir, 'worker.sqlite'));
        return {
          storage,
          cleanup: async () => {
            storage.close();
            await rm(dir, { recursive: true, force: true });
          },
        };
      },
    },
    {
      name: 'file',
      makeStorage: async (): Promise<{ storage: IStoragePort; cleanup: () => Promise<void> }> => {
        const dir = await mkdtemp(path.join(tmpdir(), 'dag-cancelled-ancestor-file-'));
        const storage = new FileStoragePort(dir);
        return { storage, cleanup: async () => rm(dir, { recursive: true, force: true }) };
      },
    },
  ])('backed by $name storage', ({ makeStorage }) => {
    const cleanups: Array<() => Promise<void>> = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) await cleanup();
    });

    async function storageFor(): Promise<IStoragePort> {
      const { storage, cleanup } = await makeStorage();
      cleanups.push(cleanup);
      return storage;
    }

    it('never invokes the executor for a child whose persisted root run is cancelled, and settles the child run cancelled', async () => {
      const storage = await storageFor();
      const queue = new InMemoryQueuePort();
      await storage.saveDefinition(definition());

      const rootRun = run('root-run', 'cancelled');
      await storage.createDagRun(rootRun);

      const childRun = run('child-run', 'running', {
        rootRunId: rootRun.dagRunId,
        parentRunId: rootRun.dagRunId,
        depth: 1,
        ancestorCompositeNodeTypes: ['composite'],
      });
      await storage.createDagRun(childRun);
      const childTask = task('child-task', childRun.dagRunId);
      await storage.createTaskRun(childTask);
      await queue.enqueue(message(childRun, childTask));

      const executed: unknown[] = [];
      const worker = buildWorker(storage, queue, executed);

      const result = await worker.processOnce();
      expect(result).toEqual({
        ok: true,
        value: { processed: true, taskRunId: childTask.taskRunId, retried: false },
      });
      expect(executed).toEqual([]);
      expect((await storage.getTaskRun(childTask.taskRunId))?.status).toBe('cancelled');
      expect((await storage.getDagRun(childRun.dagRunId))?.status).toBe('cancelled');
    });

    it('never invokes the executor for a grandchild whose immediate parent is cancelled even when the root is not', async () => {
      const storage = await storageFor();
      const queue = new InMemoryQueuePort();
      await storage.saveDefinition(definition());

      const rootRun = run('root-run-2', 'running');
      await storage.createDagRun(rootRun);
      const parentRun = run('parent-run-2', 'cancelled', {
        rootRunId: rootRun.dagRunId,
        parentRunId: rootRun.dagRunId,
        depth: 1,
        ancestorCompositeNodeTypes: ['composite'],
      });
      await storage.createDagRun(parentRun);

      const grandchildRun = run('grandchild-run-2', 'running', {
        rootRunId: rootRun.dagRunId,
        parentRunId: parentRun.dagRunId,
        depth: 2,
        ancestorCompositeNodeTypes: ['composite', 'composite'],
      });
      await storage.createDagRun(grandchildRun);
      const grandchildTask = task('grandchild-task-2', grandchildRun.dagRunId);
      await storage.createTaskRun(grandchildTask);
      await queue.enqueue(message(grandchildRun, grandchildTask));

      const executed: unknown[] = [];
      const worker = buildWorker(storage, queue, executed);

      const result = await worker.processOnce();
      expect(result).toEqual({
        ok: true,
        value: { processed: true, taskRunId: grandchildTask.taskRunId, retried: false },
      });
      expect(executed).toEqual([]);
      expect((await storage.getTaskRun(grandchildTask.taskRunId))?.status).toBe('cancelled');
      expect((await storage.getDagRun(grandchildRun.dagRunId))?.status).toBe('cancelled');
      // The root itself must be left alone — only the descendant chain under the cancelled
      // ancestor is affected.
      expect((await storage.getDagRun(rootRun.dagRunId))?.status).toBe('running');
    });

    it('executes normally when neither the root nor the parent run is cancelled', async () => {
      const storage = await storageFor();
      const queue = new InMemoryQueuePort();
      await storage.saveDefinition(definition());

      const rootRun = run('root-run-3', 'running');
      await storage.createDagRun(rootRun);
      const childRun = run('child-run-3', 'running', {
        rootRunId: rootRun.dagRunId,
        parentRunId: rootRun.dagRunId,
        depth: 1,
        ancestorCompositeNodeTypes: ['composite'],
      });
      await storage.createDagRun(childRun);
      const childTask = task('child-task-3', childRun.dagRunId);
      await storage.createTaskRun(childTask);
      await queue.enqueue(message(childRun, childTask));

      const executed: unknown[] = [];
      const worker = buildWorker(storage, queue, executed);

      const result = await worker.processOnce();
      expect(result).toEqual({
        ok: true,
        value: { processed: true, taskRunId: childTask.taskRunId, retried: false },
      });
      expect(executed).toEqual([{}]);
      expect((await storage.getTaskRun(childTask.taskRunId))?.status).toBe('success');
      expect((await storage.getDagRun(childRun.dagRunId))?.status).toBe('success');
    });

    it('executes normally for a depth-0 root lineage even when its rootRunId names a cancelled run', async () => {
      // A depth-0 (root) lineage carries no parentRunId — its rootRunId anchors descendant
      // depth-capping, not a distinct ancestor to defer to, so this run's own (non-cancelled)
      // status governs, not whatever `getDagRun(rootRunId)` happens to resolve to.
      const storage = await storageFor();
      const queue = new InMemoryQueuePort();
      await storage.saveDefinition(definition());

      const unrelatedCancelledRun = run('unrelated-cancelled-run', 'cancelled');
      await storage.createDagRun(unrelatedCancelledRun);

      const rootRun = run('root-run-5', 'running', {
        rootRunId: unrelatedCancelledRun.dagRunId,
        depth: 0,
        maxDepth: 2,
        ancestorCompositeNodeTypes: [],
      });
      await storage.createDagRun(rootRun);
      const rootTask = task('root-task-5', rootRun.dagRunId);
      await storage.createTaskRun(rootTask);
      await queue.enqueue(message(rootRun, rootTask));

      const executed: unknown[] = [];
      const worker = buildWorker(storage, queue, executed);

      const result = await worker.processOnce();
      expect(result).toEqual({
        ok: true,
        value: { processed: true, taskRunId: rootTask.taskRunId, retried: false },
      });
      expect(executed).toEqual([{}]);
      expect((await storage.getTaskRun(rootTask.taskRunId))?.status).toBe('success');
    });

    it('executes normally when the persisted ancestor run referenced by lineage does not exist', async () => {
      // Lineage is not always backed by a persisted ancestor row — a caller may stamp a depth cap
      // or a synthetic ancestor id without ever creating that row in this storage. The worker
      // cannot tell that apart from a corrupted reference, so a lookup that finds nothing must not
      // block admission; only a persisted, committed-cancelled ancestor does.
      const storage = await storageFor();
      const queue = new InMemoryQueuePort();
      await storage.saveDefinition(definition());

      const childRun = run('child-run-4', 'running', {
        rootRunId: 'missing-root-run',
        parentRunId: 'missing-root-run',
        depth: 1,
        ancestorCompositeNodeTypes: ['composite'],
      });
      await storage.createDagRun(childRun);
      const childTask = task('child-task-4', childRun.dagRunId);
      await storage.createTaskRun(childTask);
      await queue.enqueue(message(childRun, childTask));

      const executed: unknown[] = [];
      const worker = buildWorker(storage, queue, executed);

      const result = await worker.processOnce();
      expect(result).toEqual({
        ok: true,
        value: { processed: true, taskRunId: childTask.taskRunId, retried: false },
      });
      expect(executed).toEqual([{}]);
      expect((await storage.getTaskRun(childTask.taskRunId))?.status).toBe('success');
    });
  });
});
