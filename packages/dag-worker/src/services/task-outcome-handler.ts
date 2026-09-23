import {
  TASK_PROGRESS_EVENTS,
  type IClockPort,
  type IDagDefinition,
  type IDagError,
  type IDagRun,
  type IQueueMessage,
  type IQueuePort,
  type IRunProgressEventReporter,
  type IStoragePort,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';

import { dispatchDownstreamReadyTasks } from './downstream-task-dispatcher.js';
import { finalizeDagRunIfTerminal } from './dag-run-finalizer.js';
import {
  failAfterAck,
  handleRetry,
  handleTerminalFailure,
  successAfterAck,
} from './worker-failure-handler.js';

import type { IWorkerLoopOptions, IWorkerLoopResult } from './worker-loop-types.js';

/**
 * What happens to a task once its executor has returned — success or failure.
 *
 * Split out of `WorkerLoopService`, which is about the LOOP: dequeue, take the lease, sweep when
 * idle. Landing an outcome is a different question, and it is the half that talks to the state
 * machine, the progress reporter, the downstream dispatcher and the run finaliser.
 *
 * The split is also what the file-size ratchet asked for, and doing it here rather than trimming
 * comments is the point: the alternative was shaving explanation off code that three review rounds
 * had shown needed it.
 */
export class TaskOutcomeHandler {
  public constructor(
    private readonly storage: IStoragePort,
    private readonly queue: IQueuePort,
    private readonly clock: IClockPort,
    private readonly options: IWorkerLoopOptions,
    private readonly runProgressEventReporter?: IRunProgressEventReporter,
  ) {}

  public async handleSuccessPath(
    message: IQueueMessage,
    taskRunId: string,
    dagRun: IDagRun,
    definition: IDagDefinition,
    output: TPortPayload,
    estimatedCredits?: number,
    totalCredits?: number,
  ): Promise<TResult<IWorkerLoopResult, IDagError>> {
    const committed = await this.storage.commitExecution(message.dagRunId, {
      kind: 'settle',
      taskRunId,
      attempt: message.attempt,
      leaseOwner: this.options.workerId,
      status: 'success',
      outputSnapshot: JSON.stringify(output),
      estimatedCredits,
      totalCredits,
    });
    if (!committed.applied) return successAfterAck(this.queue, message.messageId, taskRunId, false);
    this.runProgressEventReporter?.publish({
      dagRunId: message.dagRunId,
      eventType: TASK_PROGRESS_EVENTS.COMPLETED,
      occurredAt: this.clock.nowIso(),
      taskRunId,
      nodeId: message.nodeId,
      input: message.payload,
      output,
    });

    const dispatched = await dispatchDownstreamReadyTasks(
      dagRun,
      definition,
      message.nodeId,
      output,
      this.storage,
      this.queue,
      this.clock,
    );
    if (!dispatched.ok) {
      return failAfterAck(this.queue, message.messageId, dispatched.error);
    }

    const finalized = await finalizeDagRunIfTerminal(
      message.dagRunId,
      this.storage,
      this.clock,
      this.runProgressEventReporter,
    );
    if (!finalized.ok) {
      return failAfterAck(this.queue, message.messageId, finalized.error);
    }

    return successAfterAck(this.queue, message.messageId, taskRunId, false);
  }

  public async handleFailurePath(
    message: IQueueMessage,
    taskRunId: string,
    error: IDagError,
  ): Promise<TResult<IWorkerLoopResult, IDagError>> {
    const committed = await this.storage.commitExecution(message.dagRunId, {
      kind: 'settle',
      taskRunId,
      attempt: message.attempt,
      leaseOwner: this.options.workerId,
      status: 'failed',
      error,
    });
    if (!committed.applied) return successAfterAck(this.queue, message.messageId, taskRunId, false);
    this.runProgressEventReporter?.publish({
      dagRunId: message.dagRunId,
      eventType: TASK_PROGRESS_EVENTS.FAILED,
      occurredAt: this.clock.nowIso(),
      taskRunId,
      nodeId: message.nodeId,
      input: message.payload,
      error,
    });

    const shouldRetry =
      this.options.retryEnabled && error.retryable && message.attempt < this.options.maxAttempts;
    if (!shouldRetry) {
      return handleTerminalFailure(
        message,
        taskRunId,
        error,
        this.options,
        this.storage,
        this.queue,
        this.clock,
        this.runProgressEventReporter,
      );
    }

    return handleRetry(
      message,
      taskRunId,
      this.storage,
      this.queue,
      this.clock,
      this.options.workerId,
    );
  }
}
