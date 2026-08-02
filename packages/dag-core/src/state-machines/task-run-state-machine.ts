import { TASK_RUN_STATUS } from '../constants/status.js';
import type { TTaskRunStatus } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';

/** Events that can trigger a task run state transition. */
export type TTaskRunTransitionEvent =
  | 'QUEUE'
  | 'START'
  | 'COMPLETE_SUCCESS'
  | 'COMPLETE_FAILURE'
  | 'UPSTREAM_FAIL'
  | 'SKIP'
  | 'RETRY'
  | 'CANCEL'
  /**
   * DAG-001: return an ABANDONED task to the queue so it can be executed again.
   *
   * `running` used to be a terminal trap. A worker that died mid-node left its task there forever,
   * and on the adapter that redelivers the message recovery was GUARANTEED to fail — the redelivered
   * task hit `running:START`, which this table did not contain, so the transition errored and the
   * message was acked and dropped. The one path that could have recovered destroyed the last record
   * that the work was pending.
   *
   * A caller may only issue this once it has established the previous owner is gone: it holds the
   * task's lease, or the recorded `leaseUntil` has passed. The state machine cannot check that — it
   * is a pure function of status — so the condition belongs to the caller and is stated here so no
   * one adds a second caller that skips it.
   */
  | 'RECLAIM';

/** Result of a successful task run state transition. */
export interface ITaskRunTransitionValue {
  nextStatus: TTaskRunStatus;
  domainEvents: string[];
}

const TASK_RUN_TRANSITIONS: Record<string, TTaskRunStatus | undefined> = {
  [`${TASK_RUN_STATUS.CREATED}:QUEUE`]: TASK_RUN_STATUS.QUEUED,
  [`${TASK_RUN_STATUS.CREATED}:CANCEL`]: TASK_RUN_STATUS.CANCELLED,
  [`${TASK_RUN_STATUS.QUEUED}:START`]: TASK_RUN_STATUS.RUNNING,
  [`${TASK_RUN_STATUS.QUEUED}:UPSTREAM_FAIL`]: TASK_RUN_STATUS.UPSTREAM_FAILED,
  [`${TASK_RUN_STATUS.QUEUED}:SKIP`]: TASK_RUN_STATUS.SKIPPED,
  [`${TASK_RUN_STATUS.QUEUED}:CANCEL`]: TASK_RUN_STATUS.CANCELLED,
  [`${TASK_RUN_STATUS.RUNNING}:COMPLETE_SUCCESS`]: TASK_RUN_STATUS.SUCCESS,
  [`${TASK_RUN_STATUS.RUNNING}:COMPLETE_FAILURE`]: TASK_RUN_STATUS.FAILED,
  [`${TASK_RUN_STATUS.RUNNING}:CANCEL`]: TASK_RUN_STATUS.CANCELLED,
  [`${TASK_RUN_STATUS.FAILED}:RETRY`]: TASK_RUN_STATUS.QUEUED,
  // DAG-001: the recovery edge. The only way out of `running` other than completing or cancelling.
  [`${TASK_RUN_STATUS.RUNNING}:RECLAIM`]: TASK_RUN_STATUS.QUEUED,
};

function buildTransitionError(
  currentStatus: TTaskRunStatus,
  event: TTaskRunTransitionEvent,
): IDagError {
  return {
    code: 'DAG_STATE_TRANSITION_INVALID',
    category: 'state_transition',
    message: `TaskRun transition is not allowed: ${currentStatus} -> ${event}`,
    retryable: false,
    context: {
      currentStatus,
      event,
    },
  };
}

function buildDomainEvent(nextStatus: TTaskRunStatus): string {
  return `task.${nextStatus}`;
}

/**
 * Finite state machine for task run status transitions.
 * Enforces valid transitions (including retry from failed) and emits domain events.
 */
export class TaskRunStateMachine {
  public static transition(
    currentStatus: TTaskRunStatus,
    event: TTaskRunTransitionEvent,
  ): TResult<ITaskRunTransitionValue, IDagError> {
    const transitionKey = `${currentStatus}:${event}`;
    const nextStatus = TASK_RUN_TRANSITIONS[transitionKey];

    if (!nextStatus) {
      return {
        ok: false,
        error: buildTransitionError(currentStatus, event),
      };
    }

    return {
      ok: true,
      value: {
        nextStatus,
        domainEvents: [buildDomainEvent(nextStatus)],
      },
    };
  }
}
