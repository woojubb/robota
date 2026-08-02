import { sweepStaleTaskRuns } from './stale-task-sweeper.js';

import {
  TASK_PROGRESS_EVENTS,
  TaskRunStateMachine,
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
  const reclaimed = TaskRunStateMachine.transition(taskRun.status, 'RECLAIM');
  if (!reclaimed.ok) {
    return reclaimed;
  }
  return { ok: true, value: reclaimed.value.nextStatus };
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
function leaseUntilIso(clock: IClockPort, timeoutMs: number, leaseDurationMs: number): string {
  const boundMs = Math.max(timeoutMs, leaseDurationMs) + LEASE_GRACE_MS;
  return new Date(clock.nowEpochMs() + boundMs).toISOString();
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

  public constructor(
    private readonly clock: IClockPort,
    private readonly leaseDurationMs: number,
  ) {}

  public async sweepIfDue(storage: IStoragePort, queue: IQueuePort): Promise<void> {
    const nowMs = this.clock.nowEpochMs();
    if (nowMs - this.lastSweepAtMs < this.leaseDurationMs) {
      return;
    }
    this.lastSweepAtMs = nowMs;
    await sweepStaleTaskRuns(storage, queue, this.clock);
  }
}

/** Everything `claimTaskForExecution` needs, so the worker loop passes state rather than `this`. */
export interface IClaimTaskDeps {
  storage: IStoragePort;
  clock: IClockPort;
  reporter?: IRunProgressEventReporter;
  workerId: string;
  leaseDurationMs: number;
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
  await storage.updateTaskRunStatus(taskRun.taskRunId, started.value.nextStatus);
  await storage.setTaskRunLease(
    taskRun.taskRunId,
    deps.workerId,
    leaseUntilIso(clock, deps.timeoutMs, deps.leaseDurationMs),
  );
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
