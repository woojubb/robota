import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition, IDagRun, IQueueMessage, ITaskRun } from '@robota-sdk/dag-core';
import { InMemoryLeasePort, InMemoryQueuePort } from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { SqliteStorageAdapter } from '@robota-sdk/dag-adapters-sqlite';
import { WorkerLoopService } from '../services/worker-loop-service.js';

/**
 * Issue #2875: a persisted run's `lineage_json` can be corrupted at rest (disk-level bit rot, a
 * hand edit, a downgrade/upgrade mismatch) independently of anything this worker did. Reading that
 * row must fail the one task that depends on it, deterministically, and never crash the loop that
 * every other queued task also depends on.
 */
describe('WorkerLoopService fails a task closed on malformed persisted lineage without crashing the loop', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dag-worker-malformed-lineage-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function definitionFor(dagId: string): IDagDefinition {
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

  function runFor(dagRunId: string, dagId: string, definitionSnapshot: string): IDagRun {
    return {
      dagRunId,
      dagId,
      version: 1,
      status: 'running',
      runKey: `${dagId}:run`,
      logicalDate: '2026-02-14T03:00:00.000Z',
      trigger: 'manual',
      startedAt: '2026-02-14T03:00:00.000Z',
      definitionSnapshot,
    };
  }

  function taskFor(taskRunId: string, dagRunId: string): ITaskRun {
    return { taskRunId, dagRunId, nodeId: 'entry', status: 'queued', attempt: 1 };
  }

  function messageFor(dagRun: IDagRun, taskRun: ITaskRun): IQueueMessage {
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

  it('fails the affected task with DAG_VALIDATION_RUN_LINEAGE_INVALID and still processes the next queued task', async () => {
    const dbPath = path.join(dir, 'worker.sqlite');
    const storage = new SqliteStorageAdapter(dbPath);
    try {
      const queue = new InMemoryQueuePort();
      const lease = new InMemoryLeasePort();
      const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));

      const badDefinition = definitionFor('dag-bad');
      const badRun = runFor('dag-run-bad', 'dag-bad', JSON.stringify(badDefinition));
      const badTask = taskFor('task-run-bad', badRun.dagRunId);
      await storage.saveDefinition(badDefinition);
      await storage.createDagRun(badRun);
      await storage.createTaskRun(badTask);
      await queue.enqueue(messageFor(badRun, badTask));

      // Simulate on-disk corruption of the persisted lineage for this one run only.
      const raw = new DatabaseConstructor(dbPath);
      raw
        .prepare('UPDATE dag_runs SET lineage_json = ? WHERE dag_run_id = ?')
        .run('not-json{{', badRun.dagRunId);
      raw.close();

      const goodDefinition = definitionFor('dag-good');
      const goodRun = runFor('dag-run-good', 'dag-good', JSON.stringify(goodDefinition));
      const goodTask = taskFor('task-run-good', goodRun.dagRunId);
      await storage.saveDefinition(goodDefinition);
      await storage.createDagRun(goodRun);
      await storage.createTaskRun(goodTask);
      await queue.enqueue(messageFor(goodRun, goodTask));

      const executor = new ScriptedTaskExecutorPort(async () => ({
        ok: true as const,
        output: { done: true },
      }));
      const worker = new WorkerLoopService(storage, queue, lease, executor, clock, process.cwd(), {
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
        visibilityTimeoutMs: 30_000,
        retryEnabled: false,
        maxAttempts: 3,
        defaultTimeoutMs: 50,
      });

      // Reading the corrupted run must not throw out of processOnce.
      const firstResult = await worker.processOnce();
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;
      expect(firstResult.value).toEqual({
        processed: true,
        taskRunId: badTask.taskRunId,
        retried: false,
      });
      const failedTask = await storage.getTaskRun(badTask.taskRunId);
      expect(failedTask?.status).toBe('failed');
      expect(failedTask?.errorCode).toBe('DAG_VALIDATION_RUN_LINEAGE_INVALID');

      // The loop must still be usable afterward: the next, unrelated task processes normally.
      const secondResult = await worker.processOnce();
      expect(secondResult.ok).toBe(true);
      if (!secondResult.ok) return;
      expect(secondResult.value).toEqual({
        processed: true,
        taskRunId: goodTask.taskRunId,
        retried: false,
      });
      expect((await storage.getTaskRun(goodTask.taskRunId))?.status).toBe('success');
    } finally {
      storage.close();
    }
  });
});
