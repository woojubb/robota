import {
  EXECUTION_PROGRESS_EVENTS,
  DagRunStateMachine,
  TaskRunStateMachine,
  buildDispatchError,
  buildValidationError,
  type IClockPort,
  type IDagDefinition,
  type IDagError,
  type IRunProgressEventReporter,
  type IQueueMessage,
  type IQueuePort,
  type IStoragePort,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';

/** Input parameters for dispatching entry tasks of a created run. */
export interface IDispatchEntryTasksInput {
  dagRunId: string;
  definition: IDagDefinition;
  input: TPortPayload;
}

/** Result of dispatching entry tasks. */
export interface IDispatchEntryTasksResult {
  taskRunIds: string[];
}

/**
 * Transitions a created DAG run to running and dispatches its entry tasks to
 * the queue. Handles enqueue failures by cancelling all tasks and marking the
 * run as failed.
 */
export async function dispatchEntryTasks(
  params: IDispatchEntryTasksInput,
  storage: IStoragePort,
  queue: IQueuePort,
  clock: IClockPort,
  runProgressEventReporter?: IRunProgressEventReporter,
): Promise<TResult<IDispatchEntryTasksResult, IDagError>> {
  const { dagRunId, definition, input } = params;

  const entryNodes = definition.nodes.filter((node) => node.dependsOn.length === 0);
  if (entryNodes.length === 0) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_NO_ENTRY_NODE',
        'DAG must include at least one entry node (dependsOn = [])',
        { dagId: definition.dagId, version: definition.version },
      ),
    };
  }

  const queuedTransition = DagRunStateMachine.transition('created', 'QUEUE');
  if (!queuedTransition.ok) {
    return queuedTransition;
  }
  const queued = await storage.commitExecution(dagRunId, {
    kind: 'transition-run',
    expectedStatus: 'created',
    event: 'QUEUE',
  });
  if (!queued.applied) return { ok: true, value: { taskRunIds: [] } };

  const runningTransition = DagRunStateMachine.transition('queued', 'START');
  if (!runningTransition.ok) {
    return runningTransition;
  }
  const started = await storage.commitExecution(dagRunId, {
    kind: 'transition-run',
    expectedStatus: 'queued',
    event: 'START',
  });
  if (!started.applied) return { ok: true, value: { taskRunIds: [] } };
  runProgressEventReporter?.publish({
    dagRunId,
    eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
    occurredAt: clock.nowIso(),
    dagId: definition.dagId,
    version: definition.version,
  });

  const taskRunIds: string[] = [];
  for (const node of entryNodes) {
    const taskRunId = `${dagRunId}:${node.nodeId}:attempt:1`;
    const admitted = await storage.commitExecution(dagRunId, {
      kind: 'admit',
      dependsOn: [],
      taskRun: {
        taskRunId,
        dagRunId,
        nodeId: node.nodeId,
        status: 'queued',
        attempt: 1,
      },
    });
    if (!admitted.applied) continue;
    taskRunIds.push(taskRunId);

    const message: IQueueMessage = {
      messageId: `${taskRunId}:message`,
      dagRunId,
      taskRunId,
      nodeId: node.nodeId,
      attempt: 1,
      executionPath: [
        `dagId:${definition.dagId}`,
        `dagRunId:${dagRunId}`,
        `nodeId:${node.nodeId}`,
        `taskRunId:${taskRunId}`,
        'attempt:1',
      ],
      payload: input,
      createdAt: clock.nowIso(),
    };

    try {
      await queue.enqueue(message);
    } catch (error) {
      return handleEnqueueFailure(
        dagRunId,
        taskRunId,
        node.nodeId,
        taskRunIds,
        error,
        storage,
        clock,
        runProgressEventReporter,
      );
    }
  }

  return { ok: true, value: { taskRunIds } };
}

async function handleEnqueueFailure(
  dagRunId: string,
  taskRunId: string,
  nodeId: string,
  taskRunIds: string[],
  error: unknown,
  storage: IStoragePort,
  clock: IClockPort,
  runProgressEventReporter?: IRunProgressEventReporter,
): Promise<TResult<IDispatchEntryTasksResult, IDagError>> {
  const errorMessage =
    error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unknown error';
  const dispatchError = buildDispatchError(
    'DAG_DISPATCH_ENQUEUE_FAILED',
    'Failed to enqueue entry task',
    { dagRunId, taskRunId, nodeId, errorMessage },
  );
  const cancelledTaskTransition = TaskRunStateMachine.transition('queued', 'CANCEL');
  if (cancelledTaskTransition.ok) {
    await storage.updateTaskRunStatus(
      taskRunId,
      cancelledTaskTransition.value.nextStatus,
      dispatchError,
    );
    for (const previousTaskRunId of taskRunIds) {
      if (previousTaskRunId === taskRunId) {
        continue;
      }
      await storage.updateTaskRunStatus(
        previousTaskRunId,
        cancelledTaskTransition.value.nextStatus,
        dispatchError,
      );
    }
  }
  const failedRunTransition = DagRunStateMachine.transition('running', 'COMPLETE_FAILURE');
  if (failedRunTransition.ok) {
    const committed = await storage.commitExecution(dagRunId, {
      kind: 'transition-run',
      expectedStatus: 'running',
      event: 'COMPLETE_FAILURE',
      endedAt: clock.nowIso(),
    });
    if (committed.applied)
      runProgressEventReporter?.publish({
        dagRunId,
        eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
        occurredAt: clock.nowIso(),
        error: dispatchError,
      });
  }
  return { ok: false, error: dispatchError };
}
