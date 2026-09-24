import {
  TaskRunStateMachine,
  type ITaskSnapshotBudget,
  type IRootCreditBudget,
  resolveDagExecutionByteLimits,
  type IDagExecutionByteLimits,
  buildValidationError,
  type IClockPort,
  type IDagDefinition,
  type IDagRun,
  type IDagError,
  type ILeasePort,
  type IQueueMessage,
  type IQueuePort,
  type IStoragePort,
  type ITaskRun,
  type ITaskExecutionInput,
  type ITaskExecutorPort,
  type TTaskExecutionResult,
  type IRunProgressEventReporter,
  type TResult,
} from '@robota-sdk/dag-core';
import { resolveTrustedExecutionRoot } from '@robota-sdk/agent-core/node';
import { StaleTaskSweepThrottle } from './stale-task-sweep-throttle.js';
import {
  claimTaskForExecution,
  handleFailedClaim,
  taskOwnershipMs,
  withTaskLease,
  type IClaimTaskDeps,
} from './task-lease-recovery.js';
import { TaskOutcomeHandler } from './task-outcome-handler.js';
import { executeWithTimeout } from './task-timeout-executor.js';
import { resolveCurrentTotalCredits } from './worker-cost-progress.js';
import { loadWorkerExecutionContext } from './worker-execution-context.js';
import { failAfterAck, successAfterAck } from './worker-failure-handler.js';
import type { IWorkerLoopOptions, IWorkerLoopResult } from './worker-loop-types.js';

export type { IWorkerLoopOptions, IWorkerLoopResult } from './worker-loop-types.js';

/**
 * Processes task messages from the queue one at a time: dequeue, acquire lease,
 * execute via the task executor, handle success/failure paths including retry
 * and dead-letter routing, and finalize the DAG run when all tasks are terminal.
 *
 * @see ITaskExecutorPort for task execution contracts
 * @see ILeasePort for distributed lease contracts
 * @see TaskRunStateMachine for task state transitions
 */
export class WorkerLoopService {
  private readonly executionRoot: string;
  private readonly byteLimits: IDagExecutionByteLimits;
  private readonly cancellationPollMs: number;
  private readonly activeAttempts = new Set<{
    dagRunId: string;
    taskRunId: string;
    attempt: number;
    controller: AbortController;
  }>();

  /** Signals only attempts owned by this worker instance for the cancelled run. */
  public notifyRunCancelled(dagRunId: string): void {
    for (const active of this.activeAttempts) {
      if (active.dagRunId === dagRunId) active.controller.abort();
    }
  }

  public constructor(
    private readonly storage: IStoragePort,
    private readonly queue: IQueuePort,
    private readonly lease: ILeasePort,
    private readonly executor: ITaskExecutorPort,
    private readonly clock: IClockPort,
    executionRoot: string,
    private readonly options: IWorkerLoopOptions,
    private readonly runProgressEventReporter?: IRunProgressEventReporter,
    byteLimits?: IDagExecutionByteLimits,
    private readonly snapshotBudget?: ITaskSnapshotBudget,
    private readonly rootCreditBudget?: IRootCreditBudget,
  ) {
    this.executionRoot = resolveTrustedExecutionRoot(executionRoot);
    this.byteLimits = resolveDagExecutionByteLimits(byteLimits);
    this.cancellationPollMs = options.cancellationPollMs ?? 250;
    if (
      !Number.isSafeInteger(this.cancellationPollMs) ||
      this.cancellationPollMs < 1 ||
      this.cancellationPollMs > 60_000
    ) {
      throw new RangeError('cancellationPollMs must be an integer between 1 and 60000');
    }
  }

  /** DAG-001: the idle-branch sweep, throttled — see `task-lease-recovery.ts`. */
  private sweeper: StaleTaskSweepThrottle | undefined;
  private outcomesInstance: TaskOutcomeHandler | undefined;

  /** Lazily built: parameter properties are not assigned when field initialisers run. */
  private get outcomes(): TaskOutcomeHandler {
    this.outcomesInstance ??= new TaskOutcomeHandler(
      this.storage,
      this.queue,
      this.clock,
      this.options,
      this.runProgressEventReporter,
      this.snapshotBudget,
    );
    return this.outcomesInstance;
  }

  /** Dequeues and processes a single task message. */
  public async processOnce(): Promise<TResult<IWorkerLoopResult, IDagError>> {
    const message = await this.queue.dequeue(
      this.options.workerId,
      this.options.visibilityTimeoutMs,
      this.options.idleWaitMs,
    );
    if (!message) {
      // DAG-001: idle is when there is capacity to recover — SPEC § Crash Recovery.
      this.sweeper ??= new StaleTaskSweepThrottle(this.clock, this.lease, this.options);
      const sweepError = await this.sweeper.sweepIfDue(this.storage, this.queue);
      return sweepError
        ? { ok: false, error: sweepError }
        : { ok: true, value: { processed: false } };
    }

    return withTaskLease(
      this.lease,
      message.taskRunId,
      this.options.workerId,
      taskOwnershipMs(this.resolveTimeoutMs(message), this.options.leaseDurationMs),
      async () => this.processAcquiredMessage(message),
      async () => {
        await this.queue.nack(message.messageId);
        return { ok: true, value: { processed: false } };
      },
    );
  }

  private async processAcquiredMessage(
    message: IQueueMessage,
  ): Promise<TResult<IWorkerLoopResult, IDagError>> {
    const taskRun = await this.storage.getTaskRun(message.taskRunId);
    if (!taskRun) {
      const notFound = buildValidationError(
        'DAG_VALIDATION_TASK_RUN_NOT_FOUND',
        'TaskRun not found for dequeued message',
        { taskRunId: message.taskRunId },
      );
      return failAfterAck(this.queue, message.messageId, notFound);
    }

    const cancellationBeforeClaim = await this.cancelIfRunCancelled(message);
    if (cancellationBeforeClaim) return cancellationBeforeClaim;

    // Built once and passed to both: claiming and handling a failed claim need the same context.
    const claimDeps = this.claimDepsFor(message, taskRun);
    const startResult = await claimTaskForExecution(claimDeps);
    if (!startResult.ok) {
      return handleFailedClaim(startResult.error, claimDeps);
    }
    // The attempt now in force; a reclaim advanced storage's (`claimTaskForExecution`).
    const claimed: IQueueMessage = { ...message, attempt: startResult.value };

    const contextResult = await loadWorkerExecutionContext(this.storage, claimed);
    if (!contextResult.ok) {
      return failAfterAck(this.queue, message.messageId, contextResult.error);
    }
    const { dagRun, definition, nodeDefinition } = contextResult.value;
    if (dagRun.status === 'cancelled') {
      return this.settleCancelledRunMessage(message);
    }

    const persistInput = (snapshot: string) =>
      this.storage.commitExecution(claimed.dagRunId, {
        kind: 'snapshot-input',
        taskRunId: claimed.taskRunId,
        attempt: claimed.attempt,
        leaseOwner: this.options.workerId,
        inputSnapshot: snapshot,
      });
    const admission = this.snapshotBudget
      ? await this.snapshotBudget.admitValue('input', claimed.payload, persistInput)
      : { ok: true as const, value: await persistInput(JSON.stringify(claimed.payload)) };
    if (!admission.ok)
      return this.outcomes.handleFailurePath(claimed, claimed.taskRunId, admission.error);
    if (!admission.value.applied)
      return successAfterAck(this.queue, message.messageId, claimed.taskRunId, false);

    const input = await this.buildExecutionInput(claimed, dagRun, definition, nodeDefinition);
    // Registration precedes the final persisted read, closing its stale-snapshot race.
    const controller = new AbortController();
    const active = {
      dagRunId: claimed.dagRunId,
      taskRunId: claimed.taskRunId,
      attempt: claimed.attempt,
      controller,
    };
    this.activeAttempts.add(active);
    let executionResult: TTaskExecutionResult;
    let stopCancellationWatch: (() => void) | undefined;
    try {
      // Input assembly awaits storage. A cancellation during that await must close admission too.
      const cancellationBeforeExecution = await this.cancelIfRunCancelled(message);
      if (cancellationBeforeExecution) return cancellationBeforeExecution;
      stopCancellationWatch = this.watchCommittedCancellation(active);
      executionResult = await executeWithTimeout(
        this.executor,
        { ...input, signal: controller.signal },
        claimDeps.timeoutMs,
        message.taskRunId,
      );
    } finally {
      stopCancellationWatch?.();
      this.activeAttempts.delete(active);
    }

    if (executionResult.ok) {
      return this.outcomes.handleSuccessPath(
        claimed,
        taskRun.taskRunId,
        dagRun,
        definition,
        executionResult.output,
        executionResult.estimatedCredits,
        executionResult.totalCredits,
      );
    }

    return this.outcomes.handleFailurePath(claimed, taskRun.taskRunId, executionResult.error);
  }

  /**
   * A separate process cannot call this worker's local notifier. Read durable state while
   * its attempt is active so SQLite-backed workers can abort a running provider promptly.
   * The next read is scheduled only after the previous one settles, and stopping the
   * watcher prevents a late read from aborting an already-finished attempt.
   */
  private watchCommittedCancellation(active: {
    dagRunId: string;
    controller: AbortController;
  }): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (): Promise<void> => {
      if (stopped) return;
      try {
        const run = await this.storage.getDagRun(active.dagRunId);
        if (!stopped && run?.status !== 'running') active.controller.abort();
      } catch {
        // An unreadable authority cannot justify continuing a live attempt.
        if (!stopped) active.controller.abort();
      }
      if (!stopped && !active.controller.signal.aborted) {
        timer = setTimeout(() => {
          void check();
        }, this.cancellationPollMs);
      }
    };
    timer = setTimeout(() => {
      void check();
    }, this.cancellationPollMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }

  private async cancelIfRunCancelled(
    message: IQueueMessage,
  ): Promise<TResult<IWorkerLoopResult, IDagError> | undefined> {
    const run = await this.storage.getDagRun(message.dagRunId);
    return run?.status === 'cancelled' ? this.settleCancelledRunMessage(message) : undefined;
  }

  private async settleCancelledRunMessage(
    message: IQueueMessage,
  ): Promise<TResult<IWorkerLoopResult, IDagError>> {
    const taskRun = await this.storage.getTaskRun(message.taskRunId);
    if (taskRun) {
      const cancelled = TaskRunStateMachine.transition(taskRun.status, 'CANCEL');
      if (cancelled.ok) {
        await this.storage.updateTaskRunStatus(taskRun.taskRunId, cancelled.value.nextStatus);
      }
      await this.storage.setTaskRunLease(taskRun.taskRunId, undefined, undefined);
    }
    return successAfterAck(this.queue, message.messageId, message.taskRunId, false);
  }

  private async buildExecutionInput(
    message: IQueueMessage,
    dagRun: IDagRun,
    definition: IDagDefinition,
    nodeDefinition: IDagDefinition['nodes'][number],
  ): Promise<ITaskExecutionInput> {
    const allTaskRunsForCost = await this.storage.listTaskRunsByDagRunId(message.dagRunId);
    const currentTotalCredits = resolveCurrentTotalCredits(allTaskRunsForCost);
    return {
      executionRoot: this.executionRoot,
      byteLimits: this.byteLimits,
      snapshotBudget: this.snapshotBudget,
      rootCreditBudget: this.rootCreditBudget,
      reserveCredits: definition.costPolicy
        ? async (estimatedCredits) => {
            const committed = await this.storage.commitExecution(message.dagRunId, {
              kind: 'reserve-credits',
              taskRunId: message.taskRunId,
              attempt: message.attempt,
              leaseOwner: this.options.workerId,
              estimatedCredits,
            });
            if (committed.applied) return { ok: true, value: undefined };
            return {
              ok: false,
              error:
                committed.error ??
                buildValidationError(
                  'DAG_VALIDATION_CREDIT_RESERVATION_REJECTED',
                  'Task attempt lost credit reservation authority',
                  { taskRunId: message.taskRunId },
                ),
            };
          }
        : undefined,
      dagId: dagRun.dagId,
      dagRunId: message.dagRunId,
      taskRunId: message.taskRunId,
      nodeId: message.nodeId,
      attempt: message.attempt,
      executionPath: message.executionPath,
      input: message.payload,
      nodeDefinition,
      costPolicy: definition.costPolicy,
      currentTotalCredits,
    };
  }

  private claimDepsFor(message: IQueueMessage, taskRun: ITaskRun): IClaimTaskDeps {
    return {
      storage: this.storage,
      queue: this.queue,
      clock: this.clock,
      reporter: this.runProgressEventReporter,
      options: this.options,
      timeoutMs: this.resolveTimeoutMs(message),
      message,
      taskRun,
    };
  }

  private resolveTimeoutMs(message: IQueueMessage): number {
    const timeoutFromPayload = message.payload.timeoutMs;
    if (typeof timeoutFromPayload === 'number' && timeoutFromPayload > 0) {
      return timeoutFromPayload;
    }
    return this.options.defaultTimeoutMs;
  }
}
