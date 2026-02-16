import { DAG_RUN_STATUS } from '../constants/status.js';
import type { TDagRunStatus } from '../types/domain.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';

export type TDagRunTransitionEvent =
    | 'QUEUE'
    | 'START'
    | 'COMPLETE_SUCCESS'
    | 'COMPLETE_FAILURE'
    | 'CANCEL';

export interface IDagRunTransitionValue {
    nextStatus: TDagRunStatus;
    domainEvents: string[];
}

const DAG_RUN_TRANSITIONS: Record<string, TDagRunStatus | undefined> = {
    [`${DAG_RUN_STATUS.CREATED}:QUEUE`]: DAG_RUN_STATUS.QUEUED,
    [`${DAG_RUN_STATUS.CREATED}:CANCEL`]: DAG_RUN_STATUS.CANCELLED,
    [`${DAG_RUN_STATUS.QUEUED}:START`]: DAG_RUN_STATUS.RUNNING,
    [`${DAG_RUN_STATUS.QUEUED}:CANCEL`]: DAG_RUN_STATUS.CANCELLED,
    [`${DAG_RUN_STATUS.RUNNING}:COMPLETE_SUCCESS`]: DAG_RUN_STATUS.SUCCESS,
    [`${DAG_RUN_STATUS.RUNNING}:COMPLETE_FAILURE`]: DAG_RUN_STATUS.FAILED,
    [`${DAG_RUN_STATUS.RUNNING}:CANCEL`]: DAG_RUN_STATUS.CANCELLED
};

function buildTransitionError(
    currentStatus: TDagRunStatus,
    event: TDagRunTransitionEvent
): IDagError {
    return {
        code: 'DAG_STATE_TRANSITION_INVALID',
        category: 'state_transition',
        message: `DagRun transition is not allowed: ${currentStatus} -> ${event}`,
        retryable: false,
        context: {
            currentStatus,
            event
        }
    };
}

function buildDomainEvent(nextStatus: TDagRunStatus): string {
    return `run.${nextStatus}`;
}

export class DagRunStateMachine {
    public static transition(
        currentStatus: TDagRunStatus,
        event: TDagRunTransitionEvent
    ): TResult<IDagRunTransitionValue, IDagError> {
        const transitionKey = `${currentStatus}:${event}`;
        const nextStatus = DAG_RUN_TRANSITIONS[transitionKey];

        if (!nextStatus) {
            return {
                ok: false,
                error: buildTransitionError(currentStatus, event)
            };
        }

        return {
            ok: true,
            value: {
                nextStatus,
                domainEvents: [buildDomainEvent(nextStatus)]
            }
        };
    }
}
