import { sweepStaleTaskRuns } from './stale-task-sweeper.js';

import {
  TASK_PROGRESS_EVENTS,
  TaskRunStateMachine,
  type ILeasePort,
  type IQueueMessage,
  type IQueuePort,
  type IRunProgressEventReporter,
  type IStoragePort,
  type IClockPort,
  type IDagError,
  type ITaskRun,
  type TResult,
  type TTaskRunStatus,
} from '@robota-sdk/dag-core';

/**
 * Crash-recovery decisions for a single task, kept out of the worker loop. DAG-001.
 *
 * These are pure functions of state and time: whether a task the worker just dequeued was ABANDONED
 * by a dead owner, and how long the worker may hold it before a sweeper is entitled to take it back.
 * Extracting them is not only a size concern — a reader asking "when is it safe to take someone
 * else's task?" should find the whole answer in one place rather than inside a 400-line loop.
 */

/**
 * Slack between a task's own timeout and the point a sweeper may reclaim it. Covers the gap between
 * the timeout firing and the terminal status write landing, so a task that failed cleanly is never
 * also swept as abandoned.
 */
const LEASE_GRACE_MS = 30_000;

/**
 * The status a dequeued task should START from — reclaiming it first if it was abandoned.
 *
 * A task already `running` when its message arrives was left there by a worker that never came back.
 * Before DAG-001 this hit `transition('running','START')`, which the table did not contain, so the
 * transition errored and the message was acked and DROPPED: the one path that could have recovered
 * destroyed the last record that the work was pending.
 *
 * SAFE ONLY AFTER THE LEASE IS HELD. The caller reaches this having already acquired the task's
 * lease; a live owner still holds its own, so a duplicate delivery during genuine execution is nacked
 * before it gets here. Acquiring means the previous owner released it or died and let it expire —
 * which is the definition of abandoned. Do not call this from anywhere that has not established that.
 */
function reclaimIfAbandoned(taskRun: ITaskRun): TResult<TTaskRunStatus, IDagError> {
  if (taskRun.status !== 'running') {
    return { ok: true, value: taskRun.status };
  }
  // `running:RECLAIM` is in the table and `status` is narrowed to `running` above, so this cannot
  // fail — but it goes through the state machine rather than hardcoding `queued`, so the table stays
  // the single place the legal transitions live.
  const reclaimed = TaskRunStateMachine.transition(taskRun.status, 'RECLAIM');
  return reclaimed.ok
    ? { ok: true, value: reclaimed.value.nextStatus }
    : /* istanbul ignore next */ reclaimed;
}

/**
 * When this task's lease expires — derived from the time the task is actually ALLOWED to run.
 *
 * NOT `leaseDurationMs`. That bounds how long a worker may hold the distributed lock; a task's
 * execution is bounded by `executeWithTimeout(timeoutMs)`, and the two are unrelated numbers. Using
 * the lock duration here would let the sweeper reclaim a task that is still legitimately executing —
 * a node with a 60s timeout under the default 30s lease would be re-queued and run TWICE, which is a
 * worse failure than the one DAG-001 set out to fix.
 *
 * A task that outlives this has outlived its own timeout, so its worker is either dead or about to
 * abandon it either way.
 */
export function taskOwnershipMs(timeoutMs: number, leaseDurationMs: number): number {
  return Math.max(timeoutMs, leaseDurationMs) + LEASE_GRACE_MS;
}

function leaseUntilIso(clock: IClockPort, timeoutMs: number, leaseDurationMs: number): string {
  return new Date(clock.nowEpochMs() + taskOwnershipMs(timeoutMs, leaseDurationMs)).toISOString();
}

/**
 * Runs the stale-task sweep at most once per lease duration.
 *
 * A lease cannot expire faster than `leaseDurationMs`, so sweeping more often than that can only
 * re-read storage to find the same nothing. Unthrottled it would run on every idle tick — which, with
 * the driver's 25ms idle floor, is a storage query forty times a second per worker.
 *
 * Owns its own clock state so the worker loop does not carry a field whose only reader is this rule.
 */
export class StaleTaskSweepThrottle {
  /** Zero means "never swept", so the first idle tick sweeps. */
  private lastSweepAtMs = 0;

  /** Guards against two overlapping sweeps on one throttle, now that the clock advances after. */
  private sweeping = false;

  public constructor(
    private readonly clock: IClockPort,
    private readonly lease: ILeasePort,
    private readonly options: { workerId: string; leaseDurationMs: number; maxAttempts: number },
  ) {}

  /**
   * Returns the sweep's failure rather than throwing it.
   *
   * A sweep runs on the IDLE branch of `processOnce`, whose promise the drivers only `.catch` when
   * stopping — so a throw here escaped into an unhandled rejection and killed the worker loop. Review
   * measured that path via the sqlite queue's PRIMARY KEY. Recovery failing must not take the worker
   * with it; the loop reports it, backs off, and tries again on the next idle tick.
   */
  public async sweepIfDue(
    storage: IStoragePort,
    queue: IQueuePort,
  ): Promise<IDagError | undefined> {
    const nowMs = this.clock.nowEpochMs();
    if (this.sweeping || nowMs - this.lastSweepAtMs < this.options.leaseDurationMs) {
      return undefined;
    }
    this.sweeping = true;
    try {
      const outcome = await sweepStaleTaskRuns(
        storage,
        queue,
        this.clock,
        this.lease,
        this.options,
      );
      const first = outcome.failed[0];
      if (first === undefined) {
        return undefined;
      }
      // A per-task failure is reported by the sweep rather than thrown, so it would otherwise be
      // swallowed here. Silence is not success: surface the first one as the loop's error.
      throw first.error;
    } catch (error) {
      return {
        code: 'DAG_TASK_SWEEP_FAILED',
        category: 'task_execution',
        message: `Stale-task sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
        context: { workerId: this.options.workerId },
      };
    } finally {
      // Advanced AFTER the sweep, not before: a throwing sweep would otherwise suppress every retry
      // for a full lease duration, turning one failure into a window with no recovery at all.
      this.lastSweepAtMs = this.clock.nowEpochMs();
      this.sweeping = false;
    }
  }
}

/** Everything `claimTaskForExecution` needs, so the worker loop passes state rather than `this`. */
export interface IClaimTaskDeps {
  storage: IStoragePort;
  clock: IClockPort;
  reporter: IRunProgressEventReporter | undefined;
  options: { workerId: string; leaseDurationMs: number };
  timeoutMs: number;
  message: IQueueMessage;
  taskRun: ITaskRun;
}

/**
 * Take ownership of a dequeued task and move it to `running`.
 *
 * Reclaims first if the task was abandoned, records the lease so a task abandoned from HERE is
 * findable in turn, then publishes the start event and the input snapshot. Grouped with the recovery
 * decisions above because claiming and reclaiming are the same question asked at two moments.
 */
export async function claimTaskForExecution(
  deps: IClaimTaskDeps,
): Promise<TResult<void, IDagError>> {
  const { storage, clock, message, taskRun } = deps;
  const reclaimed = reclaimIfAbandoned(taskRun);
  if (!reclaimed.ok) {
    return reclaimed;
  }
  const started = TaskRunStateMachine.transition(reclaimed.value, 'START');
  if (!started.ok) {
    return started;
  }
  // LEASE FIRST, then the status. These are two writes with no transaction between them, and a
  // sweeper running in the gap would see `running` with no lease — the shape it treats as abandoned —
  // and reclaim a task that was in the middle of STARTING. In this order the gap contains a `queued`
  // task carrying a lease, which no sweeper looks at.
  await storage.setTaskRunLease(
    taskRun.taskRunId,
    deps.options.workerId,
    leaseUntilIso(clock, deps.timeoutMs, deps.options.leaseDurationMs),
  );
  await storage.updateTaskRunStatus(taskRun.taskRunId, started.value.nextStatus);
  deps.reporter?.publish({
    dagRunId: message.dagRunId,
    eventType: TASK_PROGRESS_EVENTS.STARTED,
    occurredAt: clock.nowIso(),
    taskRunId: taskRun.taskRunId,
    nodeId: message.nodeId,
    input: message.payload,
  });
  await storage.saveTaskRunSnapshots(taskRun.taskRunId, JSON.stringify(message.payload));
  return { ok: true, value: undefined };
}

/**
 * Hold the task's lease for the WHOLE of `run`, or decline the message.
 *
 * The lease is what makes reclaiming safe: a worker may only take over a task whose owner is gone,
 * and "gone" is defined by nobody holding this. Everything about that guarantee lives here rather
 * than inline in the loop, because it is one rule with two easy ways to get it silently wrong —
 * both of which review found in the first draft:
 *
 * - `return promise` inside `try/finally` runs the `finally` at the RETURN STATEMENT, not when the
 *   promise settles, so the lease was released one microtask into execution and was not held during
 *   the work at all. Measured: the same node executed twice.
 * - Acquiring for `leaseDurationMs` alone let the lease expire mid-execution (real configs pair a
 *   60s lease with a 300s default timeout), after which the queue's visibility timeout redelivered
 *   the message to a worker that could then acquire it.
 */
export async function withTaskLease<T>(
  lease: ILeasePort,
  taskRunId: string,
  workerId: string,
  ownershipMs: number,
  run: () => Promise<T>,
  onDeclined: () => Promise<T>,
): Promise<T> {
  const leaseKey = `taskRun:${taskRunId}`;
  const acquired = await lease.acquire(leaseKey, workerId, ownershipMs);
  if (!acquired) {
    return onDeclined();
  }
  try {
    return await run();
  } finally {
    await lease.release(leaseKey, workerId);
  }
}
