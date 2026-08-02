import {
  TaskRunStateMachine,
  type IClockPort,
  type IDagError,
  type ILeasePort,
  type IQueueMessage,
  type IQueuePort,
  type IStoragePort,
  type ITaskRun,
  type TPortPayload,
  type TTaskRunStatus,
} from '@robota-sdk/dag-core';

import { finalizeDagRunIfTerminal } from './dag-run-finalizer.js';

/**
 * Return tasks abandoned by a dead worker to the queue. DAG-001.
 *
 * The worker loop reclaims an abandoned task when its message is REDELIVERED — which only the
 * in-memory queue does. On a queue without redelivery a worker dies, its task stays `running`, and
 * there is no message left to arrive: the run never terminates, silently and permanently. That is the
 * half of the defect no adapter could fix, because `IStoragePort` had no query that could FIND a
 * stale task. This is the reader for the query that closes it.
 *
 * WHAT MAKES A TASK STALE: its recorded `leaseUntil` has passed, or it is `running` with no lease
 * recorded at all. The second case is included deliberately — a task orphaned before its lease was
 * written has the least evidence and would otherwise be exactly the one left stuck forever.
 *
 * A swept task returns to `queued` with its attempt INCREMENTED and is executed again — bounded by
 * `maxAttempts`, exactly like any other retry. A task that keeps killing its worker is failed with
 * `DAG_TASK_ABANDONED` rather than being re-run forever, and a task belonging to a run that has
 * already finished is cancelled rather than restarted.
 */
export async function sweepStaleTaskRuns(
  storage: IStoragePort,
  queue: IQueuePort,
  clock: IClockPort,
  lease: ILeasePort,
  options: { workerId: string; maxAttempts: number; leaseDurationMs: number },
): Promise<ISweepOutcome> {
  const stale = await storage.listStaleRunningTaskRuns(clock.nowIso());
  const outcome: ISweepOutcome = {
    requeued: [],
    abandoned: [],
    skipped: [],
    failed: [],
    orphaned: [],
  };

  for (const taskRun of stale) {
    // The SAME lease a worker takes, for the same reason. Without it two idle workers sweep the same
    // task concurrently: both requeue it, the attempt jumps by two so a healthy task is failed with
    // `DAG_TASK_EXECUTION_ABANDONED` well before `maxAttempts`, and on the sqlite queue — the adapter
    // this sweeper exists for — the duplicate insert violates `message_id`'s PRIMARY KEY and throws.
    // Review measured all three.
    const leaseKey = `taskRun:${taskRun.taskRunId}`;
    const held = await lease.acquire(leaseKey, options.workerId, options.leaseDurationMs);
    if (!held) {
      outcome.skipped.push(taskRun.taskRunId);
      continue;
    }
    try {
      await sweepOne(storage, queue, clock, taskRun, options.maxAttempts, outcome);
    } catch (error) {
      // One task's failure does not strand the rest of the pass. A queue outage probably affects them
      // all and they will fail in turn, but a corrupt single row would otherwise hold up every other
      // abandoned task until the next throttle window — and the whole point of this sweep is that
      // stuck work gets unstuck.
      outcome.failed.push({ taskRunId: taskRun.taskRunId, error });
    } finally {
      await lease.release(leaseKey, options.workerId);
    }
  }

  return outcome;
}

/** One task's sweep, with its lease already held by the caller. */
async function sweepOne(
  storage: IStoragePort,
  queue: IQueuePort,
  clock: IClockPort,
  taskRun: ITaskRun,
  maxAttempts: number,
  outcome: ISweepOutcome,
): Promise<void> {
  {
    const reclaimed = TaskRunStateMachine.transition(taskRun.status, 'RECLAIM');
    if (!reclaimed.ok) {
      // A task that changed status between the query and here is no longer ours to move. REPORTED,
      // not silently continued: a sweeper that finds tasks and moves none must be observable.
      outcome.skipped.push(taskRun.taskRunId);
      return;
    }

    const dagRun = await storage.getDagRun(taskRun.dagRunId);

    // A task whose parent RUN does not exist is a referential-integrity problem, not a finished run.
    // `deleteDagRun` does not cascade to task runs in any of the three adapters, so a retention job
    // can leave exactly this. It is reported in its own bucket rather than folded into `abandoned`:
    // treating "the parent record is missing" as "the run finished" is how a data bug becomes
    // invisible. The task is still cancelled — there is no run for it to belong to — but the sweep
    // says which of the two happened.
    if (dagRun === undefined) {
      await finishTaskWithoutRun(storage, taskRun);
      outcome.orphaned.push(taskRun.taskRunId);
      return;
    }

    // A run that is already over does not get its work restarted. `RunCancelService.cancelRun`
    // updates only the RUN, leaving its tasks `running` — so without this check, cancelling a run
    // and waiting would silently re-execute the node the user cancelled. Cancel has to mean stop.
    if (TERMINAL_RUN_STATUSES.has(dagRun.status)) {
      // Through the state machine, not a literal — the table stays the single place the legal
      // transitions live, which is the rule the RECLAIM check above follows.
      const cancelled = TaskRunStateMachine.transition(taskRun.status, 'CANCEL');
      if (!cancelled.ok) {
        outcome.skipped.push(taskRun.taskRunId);
        return;
      }
      await finishTask(storage, clock, taskRun, cancelled.value.nextStatus);
      outcome.abandoned.push(taskRun.taskRunId);
      return;
    }

    // Retries are BOUNDED. Without this a task that kills its worker — or one that fails after being
    // set `running` — is swept, re-run and swept again forever, and `maxAttempts` never applies.
    if (taskRun.attempt >= maxAttempts) {
      await finishTask(storage, clock, taskRun, 'failed', {
        code: 'DAG_TASK_EXECUTION_ABANDONED',
        category: 'task_execution',
        message: `Task was abandoned by its worker ${taskRun.attempt} time(s) and has no attempts left`,
        retryable: false,
        context: { taskRunId: taskRun.taskRunId, attempt: taskRun.attempt, maxAttempts },
      });
      outcome.abandoned.push(taskRun.taskRunId);
      return;
    }

    // ORDER IS THE INVARIANT HERE: the task stays `running` — the only status a sweep looks at —
    // until a message provably exists for it. These are four independent writes with no transaction
    // between them, and the sweeper is exactly as mortal as the worker whose death it is cleaning up
    // after. Writing the status first meant a sweeper that died mid-sequence left the task `queued`
    // with no message, and `listStaleRunningTaskRuns` only queries `running` — so nothing would ever
    // find it again. That is DAG-001's own trap, reintroduced inside the recovery path. Review
    // caught it.
    //
    // The attempt is advanced BEFORE the enqueue because the message id derives from it: a crash
    // between the two burns one attempt (bounded by `maxAttempts`) rather than producing a second
    // message with an id the first already took, which the sqlite queue's PRIMARY KEY rejects.
    const nextAttempt = taskRun.attempt + 1;
    await storage.incrementTaskAttempt(taskRun.taskRunId);
    // The message carries the INCREMENTED attempt, matching what storage now holds. They disagreed by
    // one, and `handleRetry` reads the message's — so the sweeper's bound would be reached before the
    // message-driven one.
    await queue.enqueue(buildRedeliveryMessage(taskRun, nextAttempt, clock.nowIso()));
    await storage.updateTaskRunStatus(taskRun.taskRunId, reclaimed.value.nextStatus);
    // Clear the dead owner's lease last. Left in place it would be a lease belonging to a process
    // that no longer exists, attached to a task somebody else is about to run — but a crash before
    // this point leaves a task that a message will still reach, which is the outcome that matters.
    await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
    outcome.requeued.push(taskRun.taskRunId);
  }
}

/** A run in one of these has finished; its leftover tasks are not restarted. */
const TERMINAL_RUN_STATUSES = new Set(['success', 'failed', 'cancelled']);

/** What a sweep did. Reported rather than counted, so a sweep that moves nothing is still visible. */
export interface ISweepOutcome {
  /** Returned to the queue for another attempt. */
  requeued: string[];
  /** Given up on — the run is over, or the task has no attempts left. */
  abandoned: string[];
  /** Changed status between the query and the write; the next sweep re-reads them. */
  skipped: string[];
  /** Threw. Reported rather than propagated, so one bad row does not strand the rest of the pass. */
  failed: { taskRunId: string; error: unknown }[];
  /**
   * Cancelled because their parent DAG run no longer exists — a referential-integrity problem, kept
   * separate from `abandoned` so it cannot hide behind a run that merely finished.
   */
  orphaned: string[];
}

/**
 * A fresh message for the swept task, carrying the input the original message carried.
 *
 * The payload is RESTORED from `taskRun.inputSnapshot`, which `claimTaskForExecution` wrote when the
 * task was first claimed. An earlier draft sent `payload: {}` on the theory that the worker reloads
 * its context from storage — that theory was wrong, and review measured it:
 * `loadWorkerExecutionContext` reloads only the run, the definition and the node definition, while
 * `buildExecutionInput` reads `input: message.payload` straight off the message. Every task recovered
 * through the sweep would have re-executed with an empty input.
 *
 * The per-node `timeoutMs` rides the same payload, so losing it also dropped a custom timeout back to
 * the default — which, when the real timeout was the longer of the two, reopened the very
 * double-execution race the ownership bound closes.
 *
 * The `messageId` is keyed on the ATTEMPT so it cannot collide with the message the dead worker was
 * holding, nor with another sweep's — a queue that deduplicates by id would otherwise drop the
 * replacement and leave the task `queued` with nothing to pick it up, which is the same trap one
 * state along.
 */
function buildRedeliveryMessage(taskRun: ITaskRun, attempt: number, nowIso: string): IQueueMessage {
  return {
    payload: parseInputSnapshot(taskRun.inputSnapshot),
    // Keyed on the ATTEMPT, not the clock. Two sweeps in the same millisecond produced the identical
    // id, and the sqlite queue's `message_id` is a PRIMARY KEY — the second insert threw. The attempt
    // advances on every reclaim, so this is unique by construction rather than by timing.
    messageId: `${taskRun.taskRunId}:reclaim:${attempt}`,
    dagRunId: taskRun.dagRunId,
    taskRunId: taskRun.taskRunId,
    nodeId: taskRun.nodeId,
    attempt,
    executionPath: [
      `dagRunId:${taskRun.dagRunId}`,
      `nodeId:${taskRun.nodeId}`,
      `taskRunId:${taskRun.taskRunId}`,
      `attempt:${attempt}`,
      'reclaimed:true',
    ],
    createdAt: nowIso,
  };
}

/**
 * Land a task in a terminal status and finalize its run — the step the first draft of this branch
 * omitted.
 *
 * Every other path that terminates a task (`handleSuccessPath`, `handleTerminalFailure`) also calls
 * `finalizeDagRunIfTerminal`, because a run only leaves `running` once its last task is terminal.
 * Writing the task's status and stopping meant a swept task that was the run's last pending one left
 * the RUN stuck forever — the same terminal trap DAG-001 exists to close, moved one level up. Review
 * caught it, and noted the sweeper's tests asserted only the task's status, so it was accidental-green
 * on exactly that axis.
 */
async function finishTask(
  storage: IStoragePort,
  clock: IClockPort,
  taskRun: ITaskRun,
  status: TTaskRunStatus,
  error?: IDagError,
): Promise<void> {
  await storage.updateTaskRunStatus(taskRun.taskRunId, status, error);
  await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
  await finalizeDagRunIfTerminal(taskRun.dagRunId, storage, clock);
}

/**
 * The task's recorded input, or an empty payload if there is none to recover.
 *
 * A snapshot that will not parse is treated as absent rather than throwing: the alternative is that
 * one corrupt row stops the whole sweep, and a task re-run with no input is a visible failure while a
 * sweep that never runs is not. The empty case is real too — a task claimed before this field was
 * written has nothing to restore.
 */
function parseInputSnapshot(inputSnapshot: string | undefined): TPortPayload {
  if (inputSnapshot === undefined) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(inputSnapshot);
    return typeof parsed === 'object' && parsed !== null ? (parsed as TPortPayload) : {};
  } catch {
    // allow-fallback: an unparseable snapshot yields an empty input, not a thrown sweep — see above
    return {};
  }
}

/**
 * Cancel a task whose parent run is gone.
 *
 * Separate from `finishTask` because there is no run to finalize — calling `finalizeDagRunIfTerminal`
 * with a missing run would ask it to reason about a record that does not exist.
 */
async function finishTaskWithoutRun(storage: IStoragePort, taskRun: ITaskRun): Promise<void> {
  await storage.updateTaskRunStatus(taskRun.taskRunId, 'cancelled', {
    code: 'DAG_TASK_EXECUTION_ORPHANED',
    category: 'task_execution',
    message: `Task's DAG run ${taskRun.dagRunId} no longer exists; the task cannot be run or finalized`,
    retryable: false,
    context: { taskRunId: taskRun.taskRunId, dagRunId: taskRun.dagRunId },
  });
  await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
}
