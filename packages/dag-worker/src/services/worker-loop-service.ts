import {
  TASK_PROGRESS_EVENTS,
  TaskRunStateMachine,
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
  type IRunProgressEventReporter,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { dispatchDownstreamReadyTasks } from './downstream-task-dispatcher.js';
import { finalizeDagRunIfTerminal } from './dag-run-finalizer.js';
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
import {
  handleTerminalFailure,
  handleRetry,
  failAfterAck,
  successAfterAck,
} from './worker-failure-handler.js';

/** Configuration options for the worker loop, including retry and dead-letter policies. */
export interface IWorkerLoopOptions {
  workerId: string;
  leaseDurationMs: number;
  visibilityTimeoutMs: number;
  retryEnabled: boolean;
  deadLetterEnabled?: boolean;
  deadLetterQueue?: IQueuePort;
  maxAttempts: number;
  defaultTimeoutMs: number;
  idleWaitMs?: number;
}

/** Result of a single worker loop iteration. */
export interface IWorkerLoopResult {
  processed: boolean;
  taskRunId?: string;
  retried?: boolean;
}

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
  public constructor(
    private readonly storage: IStoragePort,
    private readonly queue: IQueuePort,
    private readonly lease: ILeasePort,
    private readonly executor: ITaskExecutorPort,
    private readonly clock: IClockPort,
    private readonly options: IWorkerLoopOptions,
    private readonly runProgressEventReporter?: IRunProgressEventReporter,
  ) {}

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

    const input = await this.buildExecutionInput(claimed, dagRun, definition, nodeDefinition);
    const executionResult = await executeWithTimeout(
      this.executor,
      input,
      claimDeps.timeoutMs,
      message.taskRunId,
    );

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

  private async buildExecutionInput(
    message: IQueueMessage,
    dagRun: IDagRun,
    definition: IDagDefinition,
    nodeDefinition: IDagDefinition['nodes'][number],
  ): Promise<ITaskExecutionInput> {
    const allTaskRunsForCost = await this.storage.listTaskRunsByDagRunId(message.dagRunId);
    const currentTotalCredits = resolveCurrentTotalCredits(allTaskRunsForCost);
    return {
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
