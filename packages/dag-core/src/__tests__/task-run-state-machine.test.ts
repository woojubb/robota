import { describe, it, expect } from 'vitest';
import { TaskRunStateMachine } from '../state-machines/task-run-state-machine.js';
import { TASK_RUN_STATUS } from '../constants/status.js';
import type { TTaskRunStatus } from '../types/domain.js';
import type { TTaskRunTransitionEvent } from '../state-machines/task-run-state-machine.js';

function expectOk(
    result: ReturnType<typeof TaskRunStateMachine.transition>,
    expectedStatus: TTaskRunStatus
) {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextStatus).toBe(expectedStatus);
    expect(result.value.domainEvents).toContain(`task.${expectedStatus}`);
}

function expectError(result: ReturnType<typeof TaskRunStateMachine.transition>) {
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_STATE_TRANSITION_INVALID');
    expect(result.error.category).toBe('state_transition');
    expect(result.error.retryable).toBe(false);
}

describe('TaskRunStateMachine', () => {
    describe('valid transitions', () => {
        it('should transition from created to queued via QUEUE', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.CREATED, 'QUEUE'),
                TASK_RUN_STATUS.QUEUED
            );
        });

        it('should transition from queued to running via START', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.QUEUED, 'START'),
                TASK_RUN_STATUS.RUNNING
            );
        });

        it('should transition from running to success via COMPLETE_SUCCESS', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.RUNNING, 'COMPLETE_SUCCESS'),
                TASK_RUN_STATUS.SUCCESS
            );
        });

        it('should transition from running to failed via COMPLETE_FAILURE', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.RUNNING, 'COMPLETE_FAILURE'),
                TASK_RUN_STATUS.FAILED
            );
        });

        it('should complete the happy path: created -> queued -> running -> success', () => {
            const r1 = TaskRunStateMachine.transition(TASK_RUN_STATUS.CREATED, 'QUEUE');
            expect(r1.ok).toBe(true);
            if (!r1.ok) return;

            const r2 = TaskRunStateMachine.transition(r1.value.nextStatus, 'START');
            expect(r2.ok).toBe(true);
            if (!r2.ok) return;

            const r3 = TaskRunStateMachine.transition(r2.value.nextStatus, 'COMPLETE_SUCCESS');
            expectOk(r3, TASK_RUN_STATUS.SUCCESS);
        });
    });

    describe('retry from failed', () => {
        it('should transition from failed to queued via RETRY', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.FAILED, 'RETRY'),
                TASK_RUN_STATUS.QUEUED
            );
        });

        it('should allow full retry cycle: failed -> queued -> running -> success', () => {
            const r1 = TaskRunStateMachine.transition(TASK_RUN_STATUS.FAILED, 'RETRY');
            expect(r1.ok).toBe(true);
            if (!r1.ok) return;

            const r2 = TaskRunStateMachine.transition(r1.value.nextStatus, 'START');
            expect(r2.ok).toBe(true);
            if (!r2.ok) return;

            const r3 = TaskRunStateMachine.transition(r2.value.nextStatus, 'COMPLETE_SUCCESS');
            expectOk(r3, TASK_RUN_STATUS.SUCCESS);
        });
    });

    describe('upstream_fail and skip', () => {
        it('should transition from queued to upstream_failed via UPSTREAM_FAIL', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.QUEUED, 'UPSTREAM_FAIL'),
                TASK_RUN_STATUS.UPSTREAM_FAILED
            );
        });

        it('should transition from queued to skipped via SKIP', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.QUEUED, 'SKIP'),
                TASK_RUN_STATUS.SKIPPED
            );
        });
    });

    describe('cancel from non-terminal states', () => {
        it('should cancel from created', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.CREATED, 'CANCEL'),
                TASK_RUN_STATUS.CANCELLED
            );
        });

        it('should cancel from queued', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.QUEUED, 'CANCEL'),
                TASK_RUN_STATUS.CANCELLED
            );
        });

        it('should cancel from running', () => {
            expectOk(
                TaskRunStateMachine.transition(TASK_RUN_STATUS.RUNNING, 'CANCEL'),
                TASK_RUN_STATUS.CANCELLED
            );
        });
    });

    describe('invalid transitions', () => {
        it('should reject START from created (must queue first)', () => {
            expectError(TaskRunStateMachine.transition(TASK_RUN_STATUS.CREATED, 'START'));
        });

        it('should reject RETRY from success (only from failed)', () => {
            expectError(TaskRunStateMachine.transition(TASK_RUN_STATUS.SUCCESS, 'RETRY'));
        });

        it('should reject UPSTREAM_FAIL from running', () => {
            expectError(TaskRunStateMachine.transition(TASK_RUN_STATUS.RUNNING, 'UPSTREAM_FAIL'));
        });

        const terminalNoRetry: TTaskRunStatus[] = [
            TASK_RUN_STATUS.SUCCESS,
            TASK_RUN_STATUS.UPSTREAM_FAILED,
            TASK_RUN_STATUS.SKIPPED,
            TASK_RUN_STATUS.CANCELLED,
        ];

        for (const state of terminalNoRetry) {
            it(`should reject START from terminal state ${state}`, () => {
                expectError(TaskRunStateMachine.transition(state, 'START'));
            });
        }
    });

    describe('domain events', () => {
        it('should emit domain event matching the target status', () => {
            const result = TaskRunStateMachine.transition(TASK_RUN_STATUS.QUEUED, 'START');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.domainEvents).toEqual(['task.running']);
        });
    });
});
