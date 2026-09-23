import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InMemoryLeasePort } from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { SqliteQueueAdapter, SqliteStorageAdapter } from '@robota-sdk/dag-adapters-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkerLoopService } from '../services/worker-loop-service.js';

import type { IDagDefinition, IDagRun, IQueueMessage, ITaskRun } from '@robota-sdk/dag-core';

const NOW_MS = Date.UTC(2026, 1, 14, 3, 0, 0);

describe('SQLite abandoned-task recovery (DAG-001)', () => {
  let root: string | undefined;
  const openAdapters: Array<SqliteQueueAdapter | SqliteStorageAdapter> = [];

  afterEach(async () => {
    for (const adapter of openAdapters.splice(0).reverse()) {
      adapter.close();
    }
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('reopens persisted abandoned work and advances the task and run to success through idle sweep', async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'robota-dag001-sqlite-')));
    const databasePath = path.join(root, 'dag.sqlite');
    const beforeCrashStorage = track(new SqliteStorageAdapter(databasePath));
    const beforeCrashQueue = track(new SqliteQueueAdapter(databasePath));
    const fixture = createFixture();

    await beforeCrashStorage.saveDefinition(fixture.definition);
    await beforeCrashStorage.createDagRun(fixture.dagRun);
    await beforeCrashStorage.createTaskRun(fixture.taskRun);
    await beforeCrashStorage.setTaskRunLease(
      fixture.taskRun.taskRunId,
      'dead-worker',
      new Date(NOW_MS - 1).toISOString(),
    );
    await beforeCrashQueue.enqueue(fixture.message);
    expect(await beforeCrashQueue.dequeue('dead-worker', 60_000)).toBeDefined();

    beforeCrashQueue.close();
    beforeCrashStorage.close();
    openAdapters.length = 0;

    const storage = track(new SqliteStorageAdapter(databasePath));
    const queue = track(new SqliteQueueAdapter(databasePath));
    const executedInputs: unknown[] = [];
    const worker = new WorkerLoopService(
      storage,
      queue,
      new InMemoryLeasePort(),
      new ScriptedTaskExecutorPort(async (input) => {
        executedInputs.push(input.input);
        return { ok: true, output: { done: true } };
      }),
      new ManualClockPort(NOW_MS),
      process.cwd(),
      {
        workerId: 'replacement-worker',
        leaseDurationMs: 30_000,
        visibilityTimeoutMs: 30_000,
        retryEnabled: true,
        maxAttempts: 3,
        defaultTimeoutMs: 1_000,
      },
    );

    const swept = await worker.processOnce();
    expect(swept).toEqual({ ok: true, value: { processed: false } });
    expect(await storage.getTaskRun(fixture.taskRun.taskRunId)).toMatchObject({
      status: 'queued',
      attempt: 2,
    });

    const recovered = await worker.processOnce();
    expect(recovered).toMatchObject({
      ok: true,
      value: { processed: true, taskRunId: fixture.taskRun.taskRunId },
    });
    expect(executedInputs).toEqual([{ previous: true }]);
    expect(await storage.getTaskRun(fixture.taskRun.taskRunId)).toMatchObject({
      status: 'success',
      attempt: 2,
    });
    expect(await storage.getDagRun(fixture.dagRun.dagRunId)).toMatchObject({ status: 'success' });
  });

  function track<T extends SqliteQueueAdapter | SqliteStorageAdapter>(adapter: T): T {
    openAdapters.push(adapter);
    return adapter;
  }
});

function createFixture(): {
  definition: IDagDefinition;
  dagRun: IDagRun;
  taskRun: ITaskRun;
  message: IQueueMessage;
} {
  const definition: IDagDefinition = {
    dagId: 'sqlite-recovery',
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
  const dagRun: IDagRun = {
    dagRunId: 'sqlite-recovery:run:1',
    dagId: definition.dagId,
    version: definition.version,
    status: 'running',
    runKey: 'sqlite-recovery:run-key:1',
    logicalDate: new Date(NOW_MS).toISOString(),
    trigger: 'manual',
    definitionSnapshot: JSON.stringify(definition),
    startedAt: new Date(NOW_MS - 60_000).toISOString(),
  };
  const taskRun: ITaskRun = {
    taskRunId: 'sqlite-recovery:task:entry',
    dagRunId: dagRun.dagRunId,
    nodeId: 'entry',
    status: 'running',
    attempt: 1,
    inputSnapshot: JSON.stringify({ previous: true }),
  };
  const message: IQueueMessage = {
    messageId: `${taskRun.taskRunId}:message:1`,
    dagRunId: dagRun.dagRunId,
    taskRunId: taskRun.taskRunId,
    nodeId: taskRun.nodeId,
    attempt: 1,
    executionPath: [`dagRunId:${dagRun.dagRunId}`, `taskRunId:${taskRun.taskRunId}`],
    payload: { previous: true },
    createdAt: new Date(NOW_MS - 60_000).toISOString(),
  };
  return { definition, dagRun, taskRun, message };
}
