import {
  InMemoryQueuePort,
  InMemoryStoragePort,
  InMemoryLeasePort,
} from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { describe, expect, it } from 'vitest';

import { WorkerLoopService } from '../services/worker-loop-service.js';
import { claimTaskForExecution } from '../services/task-lease-recovery.js';
import { sweepStaleTaskRuns } from '../services/stale-task-sweeper.js';

import type { IClockPort, ILeasePort, IQueuePort, IStoragePort } from '@robota-sdk/dag-core';

const MAX_ATTEMPTS = 3;
const SWEEP_OPTIONS = { workerId: 'sweeper', maxAttempts: MAX_ATTEMPTS, leaseDurationMs: 30_000 };

/** The sweep under test, with the lease and retry bound every case shares. */
function sweep(
  storage: IStoragePort,
  queue: IQueuePort,
  clock: IClockPort,
  lease: ILeasePort = new InMemoryLeasePort(),
) {
  return sweepStaleTaskRuns(storage, queue, clock, lease, SWEEP_OPTIONS);
}

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
  const lease = new InMemoryLeasePort();
  await storage.createDagRun(dagRun());
  await storage.createTaskRun(task);
  if (task.leaseOwner !== undefined || task.leaseUntil !== undefined) {
    await storage.setTaskRunLease(task.taskRunId, task.leaseOwner, task.leaseUntil);
  }
  return { storage, queue, clock, lease };
}

describe('stale running tasks are swept back onto the queue (DAG-001)', () => {
  it('requeues a task whose lease has EXPIRED', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'dead-worker', leaseUntil: EXPIRED_ISO }),
    );

    const swept = (await sweep(storage, queue, clock)).requeued;

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

    expect((await sweep(storage, queue, clock)).requeued).toEqual(['task-run-1']);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('queued');
  });

  it('leaves a task whose lease is still LIVE — a running worker is not stale', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'worker-1', leaseUntil: LIVE_ISO }),
    );

    expect((await sweep(storage, queue, clock)).requeued).toEqual([]);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('running');
    expect(await queue.dequeue('worker-9', 10)).toBeUndefined();
  });

  it('clears the dead lease so the swept task is not swept again as its own leftover', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ leaseOwner: 'dead-worker', leaseUntil: EXPIRED_ISO }),
    );

    await sweep(storage, queue, clock);

    const swept = await storage.getTaskRun('task-run-1');
    expect(swept?.leaseOwner).toBeUndefined();
    expect(swept?.leaseUntil).toBeUndefined();
    // Second pass finds nothing: the task is `queued`, not `running`.
    expect((await sweep(storage, queue, clock)).requeued).toEqual([]);
    expect(NOW_ISO).toBeDefined();
  });

  it('touches nothing when there is nothing stale', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    expect((await sweep(storage, queue, clock)).requeued).toEqual([]);
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

  /**
   * The three findings an independent review MEASURED against the first draft of this fix. Each was a
   * way the recovery path made things worse than the trap it replaced, and each is pinned here so the
   * regression cannot come back quietly.
   */
  it('does NOT restart work for a run that is already over', async () => {
    // `RunCancelService.cancelRun` updates only the RUN, leaving its tasks `running`. Without this,
    // cancelling a run and waiting silently re-executed the node the user cancelled — cancel stopped
    // meaning stop, and node side effects fired afterwards.
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    await storage.createDagRun({ ...dagRun(), status: 'cancelled' });
    await storage.createTaskRun(taskRun({ leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }));
    await storage.setTaskRunLease('task-run-1', 'dead', EXPIRED_ISO);

    const outcome = await sweep(storage, queue, clock);

    expect(outcome.requeued).toEqual([]);
    expect(outcome.abandoned).toEqual(['task-run-1']);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('cancelled');
    expect(await queue.dequeue('worker-9', 10)).toBeUndefined();
  });

  it('FAILS a task that has exhausted its attempts instead of sweeping it forever', async () => {
    // A task that kills its worker was swept, re-run and swept again with `attempt` never advancing,
    // so `maxAttempts` never applied and the loop had no end.
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    await storage.createDagRun(dagRun());
    await storage.createTaskRun(taskRun({ attempt: MAX_ATTEMPTS }));

    const outcome = await sweep(storage, queue, clock);

    expect(outcome.abandoned).toEqual(['task-run-1']);
    const task = await storage.getTaskRun('task-run-1');
    expect(task?.status).toBe('failed');
    expect(task?.errorCode).toBe('DAG_TASK_EXECUTION_ABANDONED');
    expect(await queue.dequeue('worker-9', 10)).toBeUndefined();
  });

  it('advances the attempt when it requeues, so the retry bound can ever be reached', async () => {
    const { storage, queue, clock } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );

    await sweep(storage, queue, clock);

    expect((await storage.getTaskRun('task-run-1'))?.attempt).toBe(2);
  });

  /**
   * The two hazards the SECOND review round measured. Both were still open after the first round of
   * fixes, and one of them killed the worker process outright.
   */
  it('two concurrent sweeps do not both requeue the same task', async () => {
    // Measured before this fix: both reported `requeued`, `attempt` went 1 → 3 so a healthy task
    // would be failed well before `maxAttempts`, and the two messages carried the IDENTICAL id —
    // which on the sqlite queue is a PRIMARY KEY, so the second insert threw.
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );

    const [first, second] = await Promise.all([
      sweepStaleTaskRuns(storage, queue, clock, lease, { ...SWEEP_OPTIONS, workerId: 'sweeper-a' }),
      sweepStaleTaskRuns(storage, queue, clock, lease, { ...SWEEP_OPTIONS, workerId: 'sweeper-b' }),
    ]);

    const requeued = [...first.requeued, ...second.requeued];
    expect(requeued).toEqual(['task-run-1']);
    expect((await storage.getTaskRun('task-run-1'))?.attempt).toBe(2);
    expect(await queue.dequeue('worker-9', 10)).toBeDefined();
    expect(await queue.dequeue('worker-9', 10)).toBeUndefined();
  });

  it('the reclaim message id is keyed on the ATTEMPT, so it cannot collide with itself', async () => {
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );

    await sweep(storage, queue, clock, lease);
    const message = await queue.dequeue('worker-9', 10);

    // Not the clock: two sweeps in the same millisecond produced the same string.
    expect(message?.messageId).toBe('task-run-1:reclaim:2');
    // …and the message's attempt matches what storage now holds, since `handleRetry` reads the
    // message's and would otherwise reach the retry bound one attempt early.
    expect(message?.attempt).toBe(2);
    expect((await storage.getTaskRun('task-run-1'))?.attempt).toBe(2);
  });

  it('does NOT sweep a task that is mid-CLAIM — the lease is written before the status', async () => {
    // The ordering fix had no guard: swapping the two writes back left the whole suite green, so a
    // refactor could reintroduce it silently. This runs a sweep in the window between them.
    const { storage, queue, clock, lease } = await fixture(taskRun({ status: 'queued' }));
    let sweptDuringClaim: string[] = [];

    const realUpdate = storage.updateTaskRunStatus.bind(storage);
    storage.updateTaskRunStatus = async (id, status, error) => {
      await realUpdate(id, status, error);
      if (status === 'running') {
        // The instant the task becomes `running`, a concurrent sweeper looks at it.
        sweptDuringClaim = (await sweep(storage, queue, clock, new InMemoryLeasePort())).requeued;
      }
    };

    await claimTaskForExecution({
      storage,
      clock,
      reporter: undefined,
      options: { workerId: 'worker-1', leaseDurationMs: 30_000 },
      timeoutMs: 1_000,
      message: {
        messageId: 'm1',
        dagRunId: 'dag-run-1',
        taskRunId: 'task-run-1',
        nodeId: 'entry',
        attempt: 1,
        executionPath: [],
        payload: {},
        createdAt: NOW_ISO,
      },
      taskRun: taskRun({ status: 'queued' }),
    });

    expect(sweptDuringClaim).toEqual([]);
  });
});
