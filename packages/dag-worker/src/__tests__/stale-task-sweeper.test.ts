import {
  InMemoryQueuePort,
  InMemoryStoragePort,
  InMemoryLeasePort,
} from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { describe, expect, it } from 'vitest';

import { WorkerLoopService } from '../services/worker-loop-service.js';
import { sweepStaleTaskRuns } from '../services/stale-task-sweeper.js';

import type { IDagRun, ITaskRun } from '@robota-sdk/dag-core';

/**
 * DAG-001, second half — the queue that does NOT redeliver.
 *
 * Reclaiming on redelivery fixes recovery only where a message comes back. The sqlite/file path has
 * no redelivery at all: a worker dies, its task stays `running`, and there is no message left to
 * arrive. The audit named the missing piece exactly — `IStoragePort` had no query that could FIND a
 * stale task, so no adapter could add recovery however it tried.
 *
 * This sweeper is the reader for `listStaleRunningTaskRuns`. Without it that query would be another
 * declared-but-unreachable seam, which is the class the whole audit is about.
 */
const NOW_MS = Date.UTC(2026, 1, 14, 3, 30, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();
const EXPIRED_ISO = new Date(NOW_MS - 60_000).toISOString();
const LIVE_ISO = new Date(NOW_MS + 60_000).toISOString();

function dagRun(): IDagRun {
  return {
    dagRunId: 'dag-run-1',
    dagId: 'dag-1',
    version: 1,
    status: 'running',
    runKey: 'dag-1:run-1',
    logicalDate: '2026-02-14T03:00:00.000Z',
    trigger: 'manual',
    startedAt: '2026-02-14T03:00:00.000Z',
  };
}

function taskRun(overrides: Partial<ITaskRun> = {}): ITaskRun {
  return {
    taskRunId: 'task-run-1',
    dagRunId: 'dag-run-1',
    nodeId: 'entry',
    status: 'running',
    attempt: 1,
    ...overrides,
  };
}

async function fixture(task: ITaskRun) {
  const storage = new InMemoryStoragePort();
  const queue = new InMemoryQueuePort();
  const clock = new ManualClockPort(NOW_MS);
  await storage.createDagRun(dagRun());
  await storage.createTaskRun(task);
  if (task.leaseOwner !== undefined || task.leaseUntil !== undefined) {
    await storage.setTaskRunLease(task.taskRunId, task.leaseOwner, task.leaseUntil);
  }
  return { storage, queue, clock };
}

describe('stale running tasks are swept back onto the queue (DAG-001)', () => {
  it('requeues a task whose lease has EXPIRED', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'dead-worker', leaseUntil: EXPIRED_ISO }),
    );

    const swept = await sweepStaleTaskRuns(storage, queue, clock);

    expect(swept).toEqual(['task-run-1']);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('queued');
    // …and there is a message to pick it up again. A status change with no message would leave the
    // task queued and unreachable, which is the same trap one state along.
    const message = await queue.dequeue('worker-9', 1_000);
    expect(message?.taskRunId).toBe('task-run-1');
  });

  it('requeues a running task with NO lease recorded at all', async () => {
    // Orphaned before its lease was written, or by a worker predating the field. Excluding these
    // would leave exactly the tasks with the least evidence permanently stuck.
    const { storage, queue, clock } = await fixture(taskRun());

    expect(await sweepStaleTaskRuns(storage, queue, clock)).toEqual(['task-run-1']);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('queued');
  });

  it('leaves a task whose lease is still LIVE — a running worker is not stale', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'worker-1', leaseUntil: LIVE_ISO }),
    );

    expect(await sweepStaleTaskRuns(storage, queue, clock)).toEqual([]);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('running');
    expect(await queue.dequeue('worker-9', 10)).toBeUndefined();
  });

  it('clears the dead lease so the swept task is not swept again as its own leftover', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'dead-worker', leaseUntil: EXPIRED_ISO }),
    );

    await sweepStaleTaskRuns(storage, queue, clock);

    const swept = await storage.getTaskRun('task-run-1');
    expect(swept?.leaseOwner).toBeUndefined();
    expect(swept?.leaseUntil).toBeUndefined();
    // Second pass finds nothing: the task is `queued`, not `running`.
    expect(await sweepStaleTaskRuns(storage, queue, clock)).toEqual([]);
    expect(NOW_ISO).toBeDefined();
  });

  it('touches nothing when there is nothing stale', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    expect(await sweepStaleTaskRuns(storage, queue, clock)).toEqual([]);
  });
  /**
   * REACHABILITY, not just correctness. A sweeper nothing calls is the declared-but-unreachable seam
   * this whole audit is about — and DAG-001's own evidence includes `ILeasePort.renew`, which has
   * existed with zero production callers. This asserts the sweep fires through the entry point the
   * three different loop drivers all go through, without any of them being changed.
   */
  it('fires from the worker loop itself when the queue is idle', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'dead-worker', leaseUntil: EXPIRED_ISO }),
    );
    const service = new WorkerLoopService(
      storage,
      queue,
      new InMemoryLeasePort(),
      new ScriptedTaskExecutorPort(async () => ({ ok: true, output: {} })),
      clock,
      {
        workerId: 'worker-2',
        leaseDurationMs: 30_000,
        visibilityTimeoutMs: 30_000,
        retryEnabled: false,
        maxAttempts: 3,
        defaultTimeoutMs: 50,
      },
    );

    // Nothing queued, so this is the idle branch — no direct sweep call anywhere in the test.
    const result = await service.processOnce();

    expect(result.ok).toBe(true);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('queued');
  });
});
