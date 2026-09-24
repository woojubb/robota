import { decodeDagDefinitionAsDagError } from './dag-definition-decoder.js';
import { buildValidationError } from '../utils/error-builders.js';
import type { TResult } from '../types/result.js';
import { TaskRunStateMachine } from '../state-machines/task-run-state-machine.js';
import {
  DagRunStateMachine,
  type TDagRunTransitionEvent,
} from '../state-machines/dag-run-state-machine.js';
import type { IDagRun, ITaskRun, TDagRunStatus } from '../types/domain.js';
import type { IDagError } from '../types/error.js';

/** An execution mutation whose preconditions and writes share one storage transaction. */
export type TExecutionCommit =
  | {
      kind: 'reserve-credits';
      taskRunId: string;
      attempt: number;
      leaseOwner: string;
      estimatedCredits: number;
    }
  | {
      kind: 'snapshot-input';
      taskRunId: string;
      attempt: number;
      leaseOwner: string;
      inputSnapshot: string;
    }
  | {
      kind: 'transition-run';
      expectedStatus: TDagRunStatus;
      event: TDagRunTransitionEvent;
      endedAt?: string;
    }
  | { kind: 'finalize'; endedAt: string }
  | { kind: 'cancel-task'; taskRunId: string; error?: IDagError }
  | { kind: 'admit'; taskRun: ITaskRun; dependsOn: readonly string[] }
  | {
      kind: 'settle';
      taskRunId: string;
      attempt: number;
      leaseOwner: string;
      status: 'success' | 'failed';
      reserveRetry?: boolean;
      error?: IDagError;
      outputSnapshot?: string;
      estimatedCredits?: number;
      totalCredits?: number;
    };

export interface IExecutionCommitResult {
  applied: boolean;
  error?: IDagError;
  runStatus?: TDagRunStatus;
  taskRun?: ITaskRun;
}

export interface IExecutionCommitDecision {
  result: IExecutionCommitResult;
  dagRun?: IDagRun;
  taskRun?: ITaskRun;
}

/** Pure decision shared by adapters; adapters MUST evaluate and apply without an intervening await. */
export function decideExecutionCommit(
  run: IDagRun | undefined,
  tasks: readonly ITaskRun[],
  mutation: TExecutionCommit,
): IExecutionCommitDecision {
  const rejected: IExecutionCommitDecision = { result: { applied: false, runStatus: run?.status } };
  if (!run) return rejected;
  if (mutation.kind === 'transition-run') {
    if (run.status !== mutation.expectedStatus) return rejected;
    const transition = DagRunStateMachine.transition(run.status, mutation.event);
    if (!transition.ok) return rejected;
    const dagRun = { ...run, status: transition.value.nextStatus, endedAt: mutation.endedAt };
    return { dagRun, result: { applied: true, runStatus: dagRun.status } };
  }
  if (mutation.kind === 'finalize') {
    if (
      run.status !== 'running' ||
      tasks.some((task) => ['created', 'queued', 'running'].includes(task.status))
    )
      return rejected;
    const pendingAdmission = hasPendingAdmission(run, tasks);
    if (!pendingAdmission.ok)
      return { result: { ...rejected.result, error: pendingAdmission.error } };
    if (pendingAdmission.value) return rejected;
    const transition = DagRunStateMachine.transition(
      run.status,
      tasks.some((task) => task.status === 'failed') ? 'COMPLETE_FAILURE' : 'COMPLETE_SUCCESS',
    );
    if (!transition.ok) return rejected;
    const status = transition.value.nextStatus;
    const dagRun: IDagRun = { ...run, status, endedAt: mutation.endedAt };
    return { dagRun, result: { applied: true, runStatus: status } };
  }
  if (mutation.kind === 'admit') {
    if (
      run.status !== 'running' ||
      mutation.taskRun.dagRunId !== run.dagRunId ||
      tasks.some(
        (task) =>
          task.nodeId === mutation.taskRun.nodeId || task.taskRunId === mutation.taskRun.taskRunId,
      ) ||
      !mutation.dependsOn.every((nodeId) =>
        tasks.some((task) => task.nodeId === nodeId && task.status === 'success'),
      )
    )
      return rejected;
    return {
      taskRun: mutation.taskRun,
      result: { applied: true, runStatus: run.status, taskRun: mutation.taskRun },
    };
  }
  const task = tasks.find((candidate) => candidate.taskRunId === mutation.taskRunId);
  if (mutation.kind === 'cancel-task') {
    if (!task || !['failed', 'cancelled'].includes(run.status)) return rejected;
    const transition = TaskRunStateMachine.transition(task.status, 'CANCEL');
    if (!transition.ok) return rejected;
    const taskRun: ITaskRun = {
      ...task,
      status: transition.value.nextStatus,
      leaseOwner: undefined,
      leaseUntil: undefined,
      reservedCredits: undefined,
      reservationAttempt: undefined,
      reservationOwner: undefined,
      errorCode: mutation.error?.code,
      errorMessage: mutation.error?.message,
    };
    return { taskRun, result: { applied: true, runStatus: run.status, taskRun } };
  }
  if (
    !task ||
    task.status !== 'running' ||
    task.attempt !== mutation.attempt ||
    task.leaseOwner !== mutation.leaseOwner
  )
    return rejected;
  if (run.status !== 'running') {
    if (run.status !== 'cancelled' || task.status !== 'running') return rejected;
    // A cancelled run may still have an active task. Settle that exact attempt, never a replacement.
    const taskRun: ITaskRun = {
      ...task,
      status: 'cancelled',
      leaseOwner: undefined,
      leaseUntil: undefined,
      reservedCredits: undefined,
      reservationAttempt: undefined,
      reservationOwner: undefined,
    };
    return { taskRun, result: { applied: false, runStatus: run.status, taskRun } };
  }
  if (mutation.kind === 'snapshot-input') {
    const taskRun = { ...task, inputSnapshot: mutation.inputSnapshot };
    return { taskRun, result: { applied: true, runStatus: run.status, taskRun } };
  }
  if (mutation.kind === 'reserve-credits') {
    const credits = mutation.estimatedCredits;
    if (!Number.isFinite(credits) || credits < 0 || run.definitionSnapshot === undefined)
      return rejected;
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(run.definitionSnapshot);
    } catch {
      return rejected;
    }
    const decoded = decodeDagDefinitionAsDagError(
      snapshot,
      'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
      'DagRun definition snapshot has invalid shape',
      { dagRunId: run.dagRunId },
    );
    if (!decoded.ok || decoded.value.costPolicy === undefined) return rejected;
    const runCreditLimit = decoded.value.costPolicy.runCreditLimit;
    if (task.reservedCredits !== undefined) {
      return {
        result: {
          ...rejected.result,
          applied:
            task.reservationAttempt === mutation.attempt &&
            task.reservationOwner === mutation.leaseOwner &&
            task.reservedCredits === credits,
        },
      };
    }
    const occupied = tasks.reduce(
      (sum, sibling) =>
        sum +
        (sibling.status === 'success' ? (sibling.estimatedCredits ?? 0) : 0) +
        (sibling.reservedCredits ?? 0),
      0,
    );
    if (occupied + credits > runCreditLimit) {
      return {
        result: {
          ...rejected.result,
          error: buildValidationError(
            'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED',
            'Estimated run credits exceeds runCreditLimit',
            { nextTotalCredits: occupied + credits, runCreditLimit },
          ),
        },
      };
    }
    const taskRun = {
      ...task,
      reservedCredits: credits,
      reservationAttempt: mutation.attempt,
      reservationOwner: mutation.leaseOwner,
    };
    return { taskRun, result: { applied: true, runStatus: run.status, taskRun } };
  }
  const transition = TaskRunStateMachine.transition(
    task.status,
    mutation.status === 'success' ? 'COMPLETE_SUCCESS' : 'COMPLETE_FAILURE',
  );
  if (!transition.ok) return rejected;
  if (mutation.status === 'success' && run.definitionSnapshot !== undefined) {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(run.definitionSnapshot);
    } catch {
      return rejected;
    }
    const decoded = decodeDagDefinitionAsDagError(
      snapshot,
      'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
      'DagRun definition snapshot has invalid shape',
      { dagRunId: run.dagRunId },
    );
    if (!decoded.ok) return rejected;
    if (decoded.value.costPolicy !== undefined && task.reservedCredits === undefined)
      return rejected;
  }
  if (
    mutation.status === 'success' &&
    task.reservedCredits !== undefined &&
    (task.reservationAttempt !== mutation.attempt ||
      task.reservationOwner !== mutation.leaseOwner ||
      mutation.estimatedCredits !== task.reservedCredits)
  )
    return rejected;
  const retry = mutation.status === 'failed' && mutation.reserveRetry === true;
  const retryTransition = retry
    ? TaskRunStateMachine.transition(transition.value.nextStatus, 'RETRY')
    : undefined;
  if (retryTransition && !retryTransition.ok) return rejected;
  const taskRun: ITaskRun = {
    ...task,
    status: retryTransition?.ok ? retryTransition.value.nextStatus : transition.value.nextStatus,
    attempt: retry ? task.attempt + 1 : task.attempt,
    reservedCredits: undefined,
    reservationAttempt: undefined,
    reservationOwner: undefined,
    errorCode: retry ? undefined : mutation.error?.code,
    errorMessage: retry ? undefined : mutation.error?.message,
    ...(mutation.outputSnapshot === undefined ? {} : { outputSnapshot: mutation.outputSnapshot }),
    ...(mutation.estimatedCredits === undefined
      ? {}
      : { estimatedCredits: mutation.estimatedCredits }),
    ...(mutation.status !== 'success' || task.reservedCredits === undefined
      ? mutation.totalCredits === undefined
        ? {}
        : { totalCredits: mutation.totalCredits }
      : {
          totalCredits:
            tasks.reduce(
              (sum, sibling) =>
                sum + (sibling.status === 'success' ? (sibling.estimatedCredits ?? 0) : 0),
              0,
            ) + task.reservedCredits,
        }),
  };
  return { taskRun, result: { applied: true, runStatus: run.status, taskRun } };
}

/** A completed frontier can still have runnable nodes that a concurrent dispatcher has not admitted. */
function hasPendingAdmission(
  run: IDagRun,
  tasks: readonly ITaskRun[],
): TResult<boolean, IDagError> {
  // Legacy/programmatic records may have no topology; their existing task-only semantics remain.
  if (run.definitionSnapshot === undefined) return { ok: true, value: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.definitionSnapshot);
  } catch {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED',
        'Failed to parse DagRun definition snapshot',
        { dagRunId: run.dagRunId },
      ),
    };
  }
  const definition = decodeDagDefinitionAsDagError(
    parsed,
    'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
    'DagRun definition snapshot has invalid shape',
    { dagRunId: run.dagRunId },
  );
  if (!definition.ok) return definition;
  return {
    ok: true,
    value: definition.value.nodes.some(
      (node) =>
        !tasks.some((task) => task.nodeId === node.nodeId) &&
        node.dependsOn.every((nodeId) =>
          tasks.some((task) => task.nodeId === nodeId && task.status === 'success'),
        ),
    ),
  };
}
