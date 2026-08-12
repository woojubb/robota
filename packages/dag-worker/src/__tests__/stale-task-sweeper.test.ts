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
      process.cwd(),
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
      queue,
      options: {
        workerId: 'worker-1',
        leaseDurationMs: 30_000,
        maxAttempts: MAX_ATTEMPTS,
        visibilityTimeoutMs: 30_000,
        retryEnabled: false,
        defaultTimeoutMs: 50,
      },
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

  /**
   * The findings CI review added. The first was accidental-green on an axis these tests never
   * asserted: they checked the TASK's status and never the run's.
   */
  it('FINALIZES the run when the abandoned task was its last pending one', async () => {
    // Writing the task's status and stopping left the RUN stuck in `running` forever — the same
    // terminal trap DAG-001 exists to close, moved one level up. Every other terminal path calls
    // `finalizeDagRunIfTerminal`; this branch did not.
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    await storage.createDagRun(dagRun());
    await storage.createTaskRun(taskRun({ attempt: MAX_ATTEMPTS }));

    await sweep(storage, queue, clock);

    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('failed');
    expect((await storage.getDagRun('dag-run-1'))?.status).toBe('failed');
  });

  it('leaves a task FINDABLE when the enqueue fails', async () => {
    // The task must still be `running` — the only status a sweep queries — because no message
    // exists for it.
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );
    queue.enqueue = async () => {
      throw new Error('queue unavailable');
    };

    const outcome = await sweep(storage, queue, clock, lease);

    // Reported, not thrown — one bad row must not strand the rest of the pass.
    expect(outcome.failed.map((f) => f.taskRunId)).toEqual(['task-run-1']);
    // …and the task is back where the next sweep can see it.
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('running');
  });

  it('RESTORES the task input on reclaim — a recovered task must not run with an empty payload', async () => {
    // The sweeper sent `payload: {}` on the theory that the worker reloads its context from storage.
    // The theory was wrong: `loadWorkerExecutionContext` reloads the run, definition and node
    // definition, while `buildExecutionInput` reads `input: message.payload` straight off the
    // message. Every task recovered through the sweep would have re-executed with no input — and the
    // per-node `timeoutMs` rides the same payload, so a custom timeout silently dropped to the
    // default, which reopens the double-execution race the ownership bound closes.
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );
    await storage.saveTaskRunSnapshots(
      'task-run-1',
      JSON.stringify({ city: 'seoul', timeoutMs: 600_000 }),
    );

    await sweep(storage, queue, clock, lease);

    const message = await queue.dequeue('worker-9', 10);
    expect(message?.payload).toEqual({ city: 'seoul', timeoutMs: 600_000 });
  });

  it('recovers with an empty input rather than throwing when the snapshot is unusable', async () => {
    // One corrupt row must not stop the whole sweep: a task re-run with no input is a visible
    // failure, a sweep that never runs is not.
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );
    await storage.saveTaskRunSnapshots('task-run-1', 'not json at all');

    const outcome = await sweep(storage, queue, clock, lease);

    expect(outcome.requeued).toEqual(['task-run-1']);
    expect((await queue.dequeue('worker-9', 10))?.payload).toEqual({});
  });

  it('one failing task does not strand the others in the same pass', async () => {
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    const lease = new InMemoryLeasePort();
    await storage.createDagRun(dagRun());
    await storage.createTaskRun(taskRun({ taskRunId: 'task-bad' }));
    await storage.createTaskRun(taskRun({ taskRunId: 'task-good' }));

    const realEnqueue = queue.enqueue.bind(queue);
    queue.enqueue = async (message) => {
      if (message.taskRunId === 'task-bad') throw new Error('queue unavailable');
      return realEnqueue(message);
    };

    const outcome = await sweep(storage, queue, clock, lease);

    expect(outcome.failed.map((f) => f.taskRunId)).toEqual(['task-bad']);
    expect(outcome.requeued).toEqual(['task-good']);
  });

  it('reports a task whose parent RUN is gone as ORPHANED, not as an ordinary abandonment', async () => {
    // `deleteDagRun` does not cascade to task runs in any of the three adapters, so a retention job
    // can leave a `running` task with no parent. Folding that into the same branch as "the run
    // finished" is how a referential-integrity bug becomes invisible — the sweep would report a
    // routine abandonment and nothing would ever say a record was missing.
    const storage = new InMemoryStoragePort();
    const queue = new InMemoryQueuePort();
    const clock = new ManualClockPort(NOW_MS);
    await storage.createTaskRun(taskRun()); // no DAG run created at all

    const outcome = await sweep(storage, queue, clock);

    expect(outcome.orphaned).toEqual(['task-run-1']);
    expect(outcome.abandoned).toEqual([]);
    const task = await storage.getTaskRun('task-run-1');
    expect(task?.status).toBe('cancelled');
    expect(task?.errorCode).toBe('DAG_TASK_EXECUTION_ORPHANED');
  });

  it('leaves a task FINDABLE when the SWEEPER ITSELF dies mid-sequence', async () => {
    // The sweeper is exactly as mortal as the worker whose death it cleans up after. Writing the
    // status before the enqueue meant a sweeper that died in between left the task `queued` with no
    // message — and `listStaleRunningTaskRuns` only queries `running`, so nothing would ever find it
    // again. DAG-001's own trap, reintroduced inside the recovery path.
    //
    // A crash is simulated by making the write that FOLLOWS the enqueue unreachable, which is the
    // same observable state a killed process leaves behind.
    for (const dieAt of ['before-enqueue', 'after-enqueue'] as const) {
      const { storage, queue, clock, lease } = await fixture(
        taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
      );
      if (dieAt === 'before-enqueue') {
        queue.enqueue = async () => {
          throw new Error('sweeper died');
        };
      } else {
        storage.updateTaskRunStatus = async () => {
          throw new Error('sweeper died');
        };
      }

      await sweep(storage, queue, clock, lease);

      const task = await storage.getTaskRun('task-run-1');
      // Still findable by the next sweep, whichever write never landed.
      expect(task?.status, `died ${dieAt}`).toBe('running');
    }
  });

  it('a SEQUENTIAL second sweep acting on a stale snapshot does not re-reclaim the same task', async () => {
    // The per-task lease excludes a CONCURRENT sweep, not a sequential one: each worker process holds
    // its own throttle, so pass B can acquire the lease the instant pass A releases it and then act
    // on a snapshot pass A has already superseded. Measured consequence before the re-read: the
    // attempt is incremented twice, and the second message either collides on an id the first took
    // (a PRIMARY KEY violation on sqlite) or becomes a second live message for one task — this PR's
    // own double-execution defect, coming back through a stale read.
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );

    // Pass A completes fully and releases its lease.
    const first = await sweep(storage, queue, clock, lease);
    expect(first.requeued).toEqual(['task-run-1']);

    // Pass B runs afterwards. Its own query re-reads storage, so it finds the task `queued` and has
    // nothing to do — which is the point: the guard must come from storage, not from a snapshot.
    const second = await sweep(storage, queue, clock, lease);

    expect(second.requeued).toEqual([]);
    expect((await storage.getTaskRun('task-run-1'))?.attempt).toBe(2);
  });

  it('re-reads under the lease, so a task claimed between query and sweep is left alone', async () => {
    // The narrow window the re-read closes: the batch query saw `running` with a dead lease, and a
    // worker legitimately claimed it before this sweep took the lease. Acting on the snapshot would
    // reclaim a task that now has a LIVE owner.
    const { storage, queue, clock, lease } = await fixture(
      taskRun({ attempt: 1, leaseOwner: 'dead', leaseUntil: EXPIRED_ISO }),
    );

    const realList = storage.listStaleRunningTaskRuns.bind(storage);
    storage.listStaleRunningTaskRuns = async (asOf) => {
      const stale = await realList(asOf);
      // …and immediately after the query, a live worker claims it.
      await storage.setTaskRunLease('task-run-1', 'worker-live', LIVE_ISO);
      return stale;
    };

    const outcome = await sweep(storage, queue, clock, lease);

    expect(outcome.requeued).toEqual([]);
    expect(outcome.skipped).toEqual(['task-run-1']);
    expect((await storage.getTaskRun('task-run-1'))?.status).toBe('running');
  });
});
