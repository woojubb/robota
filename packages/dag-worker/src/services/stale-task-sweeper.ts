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
 * WHAT THIS DOES NOT DO: it does not decide the task failed. A swept task returns to `queued` and is
 * executed again, so a node that crashed its worker will be retried; the attempt counter and the
 * retry policy govern what happens after that, as they do for any other failure. Marking it failed
 * here would turn a worker restart into a run failure.
 */
export async function sweepStaleTaskRuns(
  storage: IStoragePort,
  queue: IQueuePort,
  clock: IClockPort,
): Promise<string[]> {
  const stale = await storage.listStaleRunningTaskRuns(clock.nowIso());
  const swept: string[] = [];

  for (const taskRun of stale) {
    const reclaimed = TaskRunStateMachine.transition(taskRun.status, 'RECLAIM');
    if (!reclaimed.ok) {
      // A task that changed status between the query and here is no longer ours to move. Skipping is
      // correct and silent-safe: the next sweep re-reads the truth rather than acting on a stale read.
      continue;
    }

    await storage.updateTaskRunStatus(taskRun.taskRunId, reclaimed.value.nextStatus);
    // Clear the dead owner's lease. Left in place it would be a lease belonging to a process that no
    // longer exists, attached to a task somebody else is about to run.
    await storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
    await queue.enqueue(buildRedeliveryMessage(taskRun, clock.nowIso()));
    swept.push(taskRun.taskRunId);
  }

  return swept;
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
