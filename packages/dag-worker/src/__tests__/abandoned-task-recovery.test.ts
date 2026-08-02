import {
  InMemoryLeasePort,
  InMemoryQueuePort,
  InMemoryStoragePort,
} from '@robota-sdk/dag-adapters-local';
import { ManualClockPort, ScriptedTaskExecutorPort } from '@robota-sdk/dag-adapters-local/testing';
import { describe, expect, it } from 'vitest';

import { WorkerLoopService } from '../services/worker-loop-service.js';

import type { IDagDefinition, IDagRun, IQueueMessage, ITaskRun } from '@robota-sdk/dag-core';

/**
 * DAG-001 — `running` was a terminal trap. A worker that died mid-node left its task and its run in
 * `running` FOREVER, silently.
 *
 * Worse on the adapter that DOES redeliver: recovery was guaranteed to fail. The redelivered message
 * hit `transitionToRunning` → `transition('running', 'START')`, which the table did not contain, so
 * the transition errored and `failAfterAck` acked and DROPPED the message. The one path that could
 * have recovered instead destroyed the only remaining record that the work was pending.
 *
 * The audit stated the cause precisely: `dag-core` owns the state machine, the persistence port and
 * the lease port — the three things a recovery path needs — and none of them could express recovery.
 *
 * WHY RECLAIMING IS SAFE, since "a second worker picks up a running task" reads alarming: the worker
 * only reaches this path after `lease.acquire` SUCCEEDS. A live owner still holds its lease, so the
 * acquire fails and the message is nacked. Acquiring means the previous owner released it or its
 * lease expired — which is exactly the definition of abandoned.
 */
function createRunFixture() {
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
    ],
    edges: [],
  };

  return { dagRun, taskRun, message, definition };
}

interface IHarness {
  storage: InMemoryStoragePort;
  queue: InMemoryQueuePort;
  lease: InMemoryLeasePort;
  service: WorkerLoopService;
}

async function harness(
  executor: ScriptedTaskExecutorPort,
  workerId = 'worker-2',
): Promise<IHarness & ReturnType<typeof createRunFixture>> {
  const fixture = createRunFixture();
  const storage = new InMemoryStoragePort();
  const queue = new InMemoryQueuePort();
  const lease = new InMemoryLeasePort();
  const clock = new ManualClockPort(Date.UTC(2026, 1, 14, 3, 0, 0));

  await storage.saveDefinition(fixture.definition);
  await storage.createDagRun({
    ...fixture.dagRun,
    definitionSnapshot: JSON.stringify(fixture.definition),
  });
  await storage.createTaskRun(fixture.taskRun);

  const service = new WorkerLoopService(storage, queue, lease, executor, clock, {
    workerId,
    leaseDurationMs: 30_000,
    visibilityTimeoutMs: 30_000,
    retryEnabled: false,
    maxAttempts: 3,
    defaultTimeoutMs: 50,
  });

  return { ...fixture, storage, queue, lease, service };
}

/**
 * Abandon a task the way a crashed worker does: the task is left `running`, its lease is gone (a dead
 * process renews nothing, so the lease expires), and the message is redelivered.
 *
 * The status is set through the port rather than by running a worker and killing it, because a real
 * mid-node kill is not expressible in-process — and the state left behind is what matters, not how it
 * got there.
 */
async function abandonInFlight(h: IHarness & { taskRun: ITaskRun; message: IQueueMessage }) {
  await h.storage.updateTaskRunStatus(h.taskRun.taskRunId, 'running');
  await h.queue.enqueue(h.message);
}

describe('an abandoned task is recovered, not trapped (DAG-001)', () => {
  it('RECLAIMS a task left running by a dead worker and runs it to a terminal state', async () => {
    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));
    const h = await harness(executor);
    await abandonInFlight(h);

    const result = await h.service.processOnce();

    // Against the defect: `transition('running','START')` is not in the table, so this is an error
    // result and the message has already been acked away by `failAfterAck`.
    expect(result.ok).toBe(true);

    const task = await h.storage.getTaskRun(h.taskRun.taskRunId);
    expect(task?.status).toBe('success');
  });

  it('the RUN reaches a terminal status — it does not stay running forever', async () => {
    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));
    const h = await harness(executor);
    await abandonInFlight(h);

    await h.service.processOnce();

    // `finalizeDagRunIfTerminal` treats `running` as pending and returns early, so before the fix the
    // run stayed `running` with nothing left that could ever move it.
    const run = await h.storage.getDagRun(h.dagRun.dagRunId);
    expect(run?.status).toBe('success');
  });

  it('does NOT reclaim a task whose owner is still alive — the lease is the guard', async () => {
    const executor = new ScriptedTaskExecutorPort(async () => ({
      ok: true,
      output: { done: true },
    }));
    const h = await harness(executor);
    await abandonInFlight(h);

    // A live owner holds the lease. This is the case reclaiming must NOT touch: a duplicate delivery
    // while the first worker is genuinely still executing.
    const held = await h.lease.acquire(`taskRun:${h.taskRun.taskRunId}`, 'worker-1', 30_000);
    expect(held).toBeDefined();

    const result = await h.service.processOnce();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.processed).toBe(false);
    }
    // Untouched, and still owned by the live worker.
    const task = await h.storage.getTaskRun(h.taskRun.taskRunId);
    expect(task?.status).toBe('running');
  });

  it('a LONG task is not swept out from under itself — the lease follows its own timeout', async () => {
    // The bug this fix could easily have introduced. `leaseDurationMs` bounds how long a worker may
    // hold the distributed lock; a task's execution is bounded by its own `timeoutMs`, and the two
    // are unrelated numbers. Deriving the lease expiry from the lock duration would make a node with
    // a timeout longer than the lease reclaimable while still legitimately running — re-queued and
    // executed TWICE, which is worse than the trap DAG-001 set out to fix.
    let observed: ITaskRun | undefined;
    const h = await harness(
      new ScriptedTaskExecutorPort(async () => {
        observed = await h.storage.getTaskRun('task-run-1');
        return { ok: true, output: { done: true } };
      }),
    );
    // A task allowed to run far longer than the 30s lease.
    await h.queue.enqueue({ ...h.message, payload: { timeoutMs: 600_000 } });

    await h.service.processOnce();

    const leaseUntilMs = Date.parse(observed?.leaseUntil ?? '');
    expect(Number.isNaN(leaseUntilMs)).toBe(false);
    // Beyond the task's own timeout, not merely beyond the lease duration.
    expect(leaseUntilMs).toBeGreaterThan(Date.UTC(2026, 1, 14, 3, 0, 0) + 600_000);
  });

  it('records the lease owner and expiry while a task is in flight', async () => {
    // `ITaskRun.leaseOwner` / `leaseUntil` existed on the domain type and in the sqlite INSERT, and
    // NOTHING ever wrote them — ghost columns. They are what a sweeper needs in order to find a task
    // whose worker died on an adapter that does not redeliver, so they are made load-bearing rather
    // than deleted.
    let observed: ITaskRun | undefined;
    const h = await harness(
      new ScriptedTaskExecutorPort(async () => {
        observed = await h.storage.getTaskRun('task-run-1');
        return { ok: true, output: { done: true } };
      }),
    );
    await h.queue.enqueue(h.message);

    await h.service.processOnce();

    expect(observed?.leaseOwner).toBe('worker-2');
    expect(observed?.leaseUntil).toBeDefined();
  });
});
