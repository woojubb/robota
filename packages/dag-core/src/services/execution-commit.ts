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
      kind: 'transition-run';
      expectedStatus: TDagRunStatus;
      event: TDagRunTransitionEvent;
      endedAt?: string;
    }
  | { kind: 'finalize'; endedAt: string }
  | { kind: 'admit'; taskRun: ITaskRun; dependsOn: readonly string[] }
  | { kind: 'retry'; taskRunId: string; attempt: number; leaseOwner: string }
  | {
      kind: 'settle';
      taskRunId: string;
      attempt: number;
      leaseOwner: string;
      status: 'success' | 'failed';
      error?: IDagError;
      outputSnapshot?: string;
      estimatedCredits?: number;
      totalCredits?: number;
    };

export interface IExecutionCommitResult {
  applied: boolean;
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
  const expectedStatus = mutation.kind === 'settle' ? 'running' : 'failed';
  if (
    !task ||
    task.status !== expectedStatus ||
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
    };
    return { taskRun, result: { applied: false, runStatus: run.status, taskRun } };
  }
  const transition = TaskRunStateMachine.transition(
    task.status,
    mutation.kind === 'retry'
      ? 'RETRY'
      : mutation.status === 'success'
        ? 'COMPLETE_SUCCESS'
        : 'COMPLETE_FAILURE',
  );
  if (!transition.ok) return rejected;
  const taskRun: ITaskRun =
    mutation.kind === 'retry'
      ? {
          ...task,
          status: transition.value.nextStatus,
          attempt: task.attempt + 1,
          errorCode: undefined,
          errorMessage: undefined,
        }
      : {
          ...task,
          status: transition.value.nextStatus,
          errorCode: mutation.error?.code,
          errorMessage: mutation.error?.message,
          ...(mutation.outputSnapshot === undefined
            ? {}
            : { outputSnapshot: mutation.outputSnapshot }),
          ...(mutation.estimatedCredits === undefined
            ? {}
            : { estimatedCredits: mutation.estimatedCredits }),
          ...(mutation.totalCredits === undefined ? {} : { totalCredits: mutation.totalCredits }),
        };
  return { taskRun, result: { applied: true, runStatus: run.status, taskRun } };
}
