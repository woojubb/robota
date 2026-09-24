import {
  TaskRunStateMachine,
  DagRunStateMachine,
  LifecycleTaskExecutorPort,
  type ITaskSnapshotBudget,
  type IRootCreditBudget,
  resolveDagExecutionByteLimits,
  type IDagExecutionByteLimits,
  buildValidationError,
  decodeDagExecutionLineage,
  type IDagExecutionLineage,
  buildTaskExecutionError,
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
    private readonly lifecycleCreditAdmission = false,
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

    let lineage: IDagExecutionLineage | undefined;
    try {
      lineage = decodeDagExecutionLineage(dagRun.lineage);
    } catch {
      return this.outcomes.handleFailurePath(
        claimed,
        claimed.taskRunId,
        buildValidationError(
          'DAG_VALIDATION_RUN_LINEAGE_INVALID',
          'Persisted composite child run lineage is invalid',
          { dagRunId: claimed.dagRunId },
        ),
      );
    }

    if (lineage) {
      const ancestorCancellation = await this.cancelIfAncestorCancelled(message, dagRun, lineage);
      if (ancestorCancellation) return ancestorCancellation;
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

    const input = await this.buildExecutionInput(claimed, dagRun, definition, nodeDefinition, lineage);
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
    let preflightCredits: number | undefined;
    const executionDeadlineMs = Date.now() + claimDeps.timeoutMs;
    let stopCancellationWatch: (() => void) | undefined;
    try {
      // Input assembly awaits storage. A cancellation during that await must close admission too.
      const cancellationBeforeExecution = await this.cancelIfRunCancelled(message);
      if (cancellationBeforeExecution) return cancellationBeforeExecution;
      stopCancellationWatch = this.watchCommittedCancellation(active);
      if (
        definition.costPolicy &&
        !this.lifecycleCreditAdmission &&
        !(this.executor instanceof LifecycleTaskExecutorPort)
      ) {
        const estimateCost = this.executor.estimateCost;
        if (!estimateCost) {
          return this.outcomes.handleFailurePath(
            claimed,
            taskRun.taskRunId,
            buildValidationError(
              'DAG_VALIDATION_CREDIT_ESTIMATE_REQUIRED',
              'Cost-limited runs require a custom executor to estimate credits before execution',
              { taskRunId: claimed.taskRunId },
            ),
          );
        }
        const estimated = await executeWithTimeout(
          {
            execute: async (estimateInput) => {
              const result = await estimateCost.call(this.executor, estimateInput);
              return result.ok ? { ok: true, output: {}, estimatedCredits: result.value } : result;
            },
            ...(this.executor.stopAndWait
              ? { stopAndWait: this.executor.stopAndWait.bind(this.executor) }
              : {}),
          },
          { ...input, signal: controller.signal },
          Math.max(1, executionDeadlineMs - Date.now()),
          message.taskRunId,
        );
        if (!estimated.ok)
          return this.outcomes.handleFailurePath(claimed, taskRun.taskRunId, estimated.error);
        if (
          estimated.estimatedCredits === undefined ||
          !Number.isFinite(estimated.estimatedCredits) ||
          estimated.estimatedCredits < 0
        ) {
          return this.outcomes.handleFailurePath(
            claimed,
            taskRun.taskRunId,
            buildValidationError(
              'DAG_VALIDATION_CREDIT_ESTIMATE_INVALID',
              'Custom executor credit estimate must be a finite nonnegative number',
              { taskRunId: claimed.taskRunId },
            ),
          );
        }
        const reserved = await input.reserveCredits!(estimated.estimatedCredits);
        if (!reserved.ok)
          return this.outcomes.handleFailurePath(claimed, taskRun.taskRunId, reserved.error);
        preflightCredits = estimated.estimatedCredits;
      }
      const remainingMs = executionDeadlineMs - Date.now();
      if (remainingMs <= 0) {
        return this.outcomes.handleFailurePath(
          claimed,
          taskRun.taskRunId,
          buildTaskExecutionError(
            'DAG_TASK_EXECUTION_TIMEOUT',
            `Task execution timed out after ${claimDeps.timeoutMs}ms`,
            true,
            { taskRunId: message.taskRunId, timeoutMs: claimDeps.timeoutMs },
          ),
        );
      }
      executionResult = await executeWithTimeout(
        this.executor,
        { ...input, signal: controller.signal },
        remainingMs,
        message.taskRunId,
      );
    } finally {
      stopCancellationWatch?.();
      this.activeAttempts.delete(active);
    }

    if (executionResult.ok) {
      if (
        preflightCredits !== undefined &&
        executionResult.estimatedCredits !== undefined &&
        executionResult.estimatedCredits !== preflightCredits
      ) {
        return this.outcomes.handleFailurePath(
          claimed,
          taskRun.taskRunId,
          buildValidationError(
            'DAG_VALIDATION_CREDIT_ESTIMATE_MISMATCH',
            'Custom executor reported credits different from its preflight estimate',
            { taskRunId: claimed.taskRunId },
          ),
        );
      }
      return this.outcomes.handleSuccessPath(
        claimed,
        taskRun.taskRunId,
        dagRun,
        definition,
        executionResult.output,
        preflightCredits ?? executionResult.estimatedCredits,
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

  /**
   * A composite child's own run status can lag its ancestor's committed cancellation — the
   * ancestor commits first and this run's own cancellation, if any, follows later (e.g. after a
   * restart, from another process). Admission that reads only its own status would still hand the
   * executor a task whose result no root will ever observe. Persisted lineage carries just the
   * root and immediate parent run ids, never a full ancestor chain, so only those two are checked;
   * a cancellation further up the chain closes each run down to its own child in turn, whose
   * lineage then names that now-cancelled run as its parent or root. A depth-0 (root) lineage
   * carries no parent — its `rootRunId` anchors descendant depth-capping rather than naming a
   * distinct ancestor run — so this only applies once a parent is present. Lineage is not always
   * backed by a persisted ancestor row (a depth cap can be supplied without one), and this worker
   * cannot tell that apart from a corrupted reference, so a lookup that finds nothing is not a
   * cancellation signal: only a persisted, committed-cancelled ancestor blocks admission.
   */
  private async cancelIfAncestorCancelled(
    message: IQueueMessage,
    dagRun: IDagRun,
    lineage: IDagExecutionLineage,
  ): Promise<TResult<IWorkerLoopResult, IDagError> | undefined> {
    if (lineage.parentRunId === undefined) return undefined;
    const ancestorIds = new Set([lineage.rootRunId, lineage.parentRunId]);
    for (const ancestorId of ancestorIds) {
      const ancestor = await this.storage.getDagRun(ancestorId);
      if (ancestor?.status === 'cancelled') {
        await this.cancelOwnRunForAncestor(dagRun);
        return this.settleCancelledRunMessage(message);
      }
    }
    return undefined;
  }

  /**
   * Cancels this run through the same committed-state transition RunCancelService uses, so a
   * descendant of a cancelled ancestor becomes cancelled itself via arbitration rather than an ad
   * hoc status write. Best-effort: the task is settled as cancelled by the caller either way, so a
   * run this finds already resolved to a different terminal status is left alone.
   */
  private async cancelOwnRunForAncestor(dagRun: IDagRun): Promise<void> {
    const transition = DagRunStateMachine.transition(dagRun.status, 'CANCEL');
    if (!transition.ok) return;
    const committed = await this.storage.commitExecution(dagRun.dagRunId, {
      kind: 'transition-run',
      expectedStatus: dagRun.status,
      event: 'CANCEL',
      endedAt: this.clock.nowIso(),
    });
    if (committed.applied || committed.runStatus === 'cancelled') {
      this.notifyRunCancelled(dagRun.dagRunId);
      return;
    }
    if (committed.runStatus !== undefined) {
      const refreshed = await this.storage.getDagRun(dagRun.dagRunId);
      if (refreshed) await this.cancelOwnRunForAncestor(refreshed);
    }
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
    lineage: IDagExecutionLineage | undefined,
  ): Promise<ITaskExecutionInput> {
    const allTaskRunsForCost = await this.storage.listTaskRunsByDagRunId(message.dagRunId);
    const currentTotalCredits = resolveCurrentTotalCredits(allTaskRunsForCost);
    return {
      executionRoot: this.executionRoot,
      ...(lineage === undefined ? {} : { lineage }),
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
