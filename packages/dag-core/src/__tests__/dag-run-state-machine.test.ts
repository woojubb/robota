import { describe, it, expect } from 'vitest';
import { DagRunStateMachine } from '../state-machines/dag-run-state-machine.js';
import { DAG_RUN_STATUS } from '../constants/status.js';
import type { TDagRunStatus } from '../types/domain.js';
import type { TDagRunTransitionEvent } from '../state-machines/dag-run-state-machine.js';

function expectOk(
    result: ReturnType<typeof DagRunStateMachine.transition>,
    expectedStatus: TDagRunStatus
) {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextStatus).toBe(expectedStatus);
    expect(result.value.domainEvents).toContain(`run.${expectedStatus}`);
}

function expectError(result: ReturnType<typeof DagRunStateMachine.transition>) {
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_STATE_TRANSITION_INVALID');
    expect(result.error.category).toBe('state_transition');
    expect(result.error.retryable).toBe(false);
}

describe('DagRunStateMachine', () => {
    describe('valid transitions', () => {
        it('should transition from created to queued via QUEUE', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.CREATED, 'QUEUE'),
                DAG_RUN_STATUS.QUEUED
            );
        });

        it('should transition from queued to running via START', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.QUEUED, 'START'),
                DAG_RUN_STATUS.RUNNING
            );
        });

        it('should transition from running to success via COMPLETE_SUCCESS', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.RUNNING, 'COMPLETE_SUCCESS'),
                DAG_RUN_STATUS.SUCCESS
            );
        });

        it('should transition from running to failed via COMPLETE_FAILURE', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.RUNNING, 'COMPLETE_FAILURE'),
                DAG_RUN_STATUS.FAILED
            );
        });

        it('should complete the full happy path: created -> queued -> running -> success', () => {
            const r1 = DagRunStateMachine.transition(DAG_RUN_STATUS.CREATED, 'QUEUE');
            expect(r1.ok).toBe(true);
            if (!r1.ok) return;

            const r2 = DagRunStateMachine.transition(r1.value.nextStatus, 'START');
            expect(r2.ok).toBe(true);
            if (!r2.ok) return;

            const r3 = DagRunStateMachine.transition(r2.value.nextStatus, 'COMPLETE_SUCCESS');
            expectOk(r3, DAG_RUN_STATUS.SUCCESS);
        });
    });

    describe('cancel from any non-terminal state', () => {
        it('should cancel from created', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.CREATED, 'CANCEL'),
                DAG_RUN_STATUS.CANCELLED
            );
        });

        it('should cancel from queued', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.QUEUED, 'CANCEL'),
                DAG_RUN_STATUS.CANCELLED
            );
        });

        it('should cancel from running', () => {
            expectOk(
                DagRunStateMachine.transition(DAG_RUN_STATUS.RUNNING, 'CANCEL'),
                DAG_RUN_STATUS.CANCELLED
            );
        });
    });

    describe('invalid transitions', () => {
        it('should reject START from created (must queue first)', () => {
            expectError(DagRunStateMachine.transition(DAG_RUN_STATUS.CREATED, 'START'));
        });

        it('should reject COMPLETE_SUCCESS from queued', () => {
            expectError(DagRunStateMachine.transition(DAG_RUN_STATUS.QUEUED, 'COMPLETE_SUCCESS'));
        });

        it('should reject QUEUE from running', () => {
            expectError(DagRunStateMachine.transition(DAG_RUN_STATUS.RUNNING, 'QUEUE'));
        });

        const terminalStates: TDagRunStatus[] = [
            DAG_RUN_STATUS.SUCCESS,
            DAG_RUN_STATUS.FAILED,
            DAG_RUN_STATUS.CANCELLED,
        ];
        const allEvents: TDagRunTransitionEvent[] = [
            'QUEUE', 'START', 'COMPLETE_SUCCESS', 'COMPLETE_FAILURE', 'CANCEL',
        ];

        for (const state of terminalStates) {
            for (const event of allEvents) {
                it(`should reject ${event} from terminal state ${state}`, () => {
                    expectError(DagRunStateMachine.transition(state, event));
                });
            }
        }
    });

    describe('domain events', () => {
        it('should emit a domain event matching the target status', () => {
            const result = DagRunStateMachine.transition(DAG_RUN_STATUS.CREATED, 'QUEUE');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.domainEvents).toEqual(['run.queued']);
        });
    });
});
