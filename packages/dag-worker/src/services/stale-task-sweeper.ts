import {
  TaskRunStateMachine,
  type IClockPort,
  type IQueueMessage,
  type IQueuePort,
  type IStoragePort,
  type ITaskRun,
} from '@robota-sdk/dag-core';

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
  maxAttempts: number,
): Promise<ISweepOutcome> {
  const stale = await storage.listStaleRunningTaskRuns(clock.nowIso());
  const outcome: ISweepOutcome = { requeued: [], abandoned: [], skipped: [] };

  for (const taskRun of stale) {
    const reclaimed = TaskRunStateMachine.transition(taskRun.status, 'RECLAIM');
    if (!reclaimed.ok) {
      // A task that changed status between the query and here is no longer ours to move. REPORTED,
      // not silently continued: a sweeper that finds tasks and moves none must be observable.
      outcome.skipped.push(taskRun.taskRunId);
      continue;
    }

    // A run that is already over does not get its work restarted. `RunCancelService.cancelRun`
    // updates only the RUN, leaving its tasks `running` — so without this check, cancelling a run
    // and waiting would silently re-execute the node the user cancelled. Cancel has to mean stop.
    const dagRun = await storage.getDagRun(taskRun.dagRunId);
    if (dagRun === undefined || TERMINAL_RUN_STATUSES.has(dagRun.status)) {
      await storage.updateTaskRunStatus(taskRun.taskRunId, 'cancelled');
      await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
      outcome.abandoned.push(taskRun.taskRunId);
      continue;
    }

    // Retries are BOUNDED. Without this a task that kills its worker — or one that fails after being
    // set `running` — is swept, re-run and swept again forever, and `maxAttempts` never applies.
    if (taskRun.attempt >= maxAttempts) {
      await storage.updateTaskRunStatus(taskRun.taskRunId, 'failed', {
        code: 'DAG_TASK_ABANDONED',
        category: 'task_execution',
        message: `Task was abandoned by its worker ${taskRun.attempt} time(s) and has no attempts left`,
        retryable: false,
        context: { taskRunId: taskRun.taskRunId, attempt: taskRun.attempt, maxAttempts },
      });
      await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
      outcome.abandoned.push(taskRun.taskRunId);
      continue;
    }

    await storage.updateTaskRunStatus(taskRun.taskRunId, reclaimed.value.nextStatus);
    // Clear the dead owner's lease. Left in place it would be a lease belonging to a process that no
    // longer exists, attached to a task somebody else is about to run.
    await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
    await storage.incrementTaskAttempt(taskRun.taskRunId);
    await queue.enqueue(buildRedeliveryMessage(taskRun, clock.nowIso()));
    outcome.requeued.push(taskRun.taskRunId);
  }

  return outcome;
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
}

/**
 * A fresh message for the swept task.
 *
 * The `messageId` is distinct per sweep so it cannot collide with the message the dead worker was
 * holding — a queue that deduplicates by id would otherwise drop the replacement and leave the task
 * `queued` with nothing to pick it up, which is the same trap one state along.
 *
 * The payload is deliberately empty: the worker reloads its execution context from storage
 * (`loadWorkerExecutionContext`) rather than trusting the message, so a sweep does not need to
 * reconstruct an input snapshot it never saw.
 */
function buildRedeliveryMessage(taskRun: ITaskRun, nowIso: string): IQueueMessage {
  return {
    messageId: `${taskRun.taskRunId}:reclaim:${nowIso}`,
    dagRunId: taskRun.dagRunId,
    taskRunId: taskRun.taskRunId,
    nodeId: taskRun.nodeId,
    attempt: taskRun.attempt,
    executionPath: [
      `dagRunId:${taskRun.dagRunId}`,
      `nodeId:${taskRun.nodeId}`,
      `taskRunId:${taskRun.taskRunId}`,
      `attempt:${taskRun.attempt}`,
      'reclaimed:true',
    ],
    payload: {},
    createdAt: nowIso,
  };
}
