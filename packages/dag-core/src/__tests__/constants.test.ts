import { describe, expect, it } from 'vitest';
import {
    RUN_EVENT_PREFIX,
    TASK_EVENT_PREFIX,
    WORKER_EVENT_PREFIX,
    SCHEDULER_EVENT_PREFIX,
    EXECUTION_EVENT_PREFIX,
    RUN_EVENTS,
    TASK_EVENTS,
    WORKER_EVENTS,
    SCHEDULER_EVENTS,
    EXECUTION_PROGRESS_EVENTS,
    TASK_PROGRESS_EVENTS
} from '../constants/events.js';
import {
    DAG_DEFINITION_STATUS,
    DAG_RUN_STATUS,
    TASK_RUN_STATUS
} from '../constants/status.js';

describe('Event prefixes', () => {
    it('has correct prefixes', () => {
        expect(RUN_EVENT_PREFIX).toBe('run');
        expect(TASK_EVENT_PREFIX).toBe('task');
        expect(WORKER_EVENT_PREFIX).toBe('worker');
        expect(SCHEDULER_EVENT_PREFIX).toBe('scheduler');
        expect(EXECUTION_EVENT_PREFIX).toBe('execution');
    });
});

describe('RUN_EVENTS', () => {
    it('has all run event names', () => {
        expect(RUN_EVENTS.CREATED).toBe('created');
        expect(RUN_EVENTS.QUEUED).toBe('queued');
        expect(RUN_EVENTS.RUNNING).toBe('running');
        expect(RUN_EVENTS.SUCCESS).toBe('success');
        expect(RUN_EVENTS.FAILED).toBe('failed');
        expect(RUN_EVENTS.CANCELLED).toBe('cancelled');
    });
});

describe('TASK_EVENTS', () => {
    it('has all task event names', () => {
        expect(TASK_EVENTS.CREATED).toBe('created');
        expect(TASK_EVENTS.QUEUED).toBe('queued');
        expect(TASK_EVENTS.RUNNING).toBe('running');
        expect(TASK_EVENTS.SUCCESS).toBe('success');
        expect(TASK_EVENTS.FAILED).toBe('failed');
        expect(TASK_EVENTS.UPSTREAM_FAILED).toBe('upstream_failed');
        expect(TASK_EVENTS.SKIPPED).toBe('skipped');
        expect(TASK_EVENTS.CANCELLED).toBe('cancelled');
    });
});

describe('WORKER_EVENTS', () => {
    it('has worker event names', () => {
        expect(WORKER_EVENTS.LEASE_ACQUIRED).toBe('lease_acquired');
        expect(WORKER_EVENTS.HEARTBEAT).toBe('heartbeat');
        expect(WORKER_EVENTS.LEASE_EXPIRED).toBe('lease_expired');
        expect(WORKER_EVENTS.EXECUTION_COMPLETE).toBe('execution_complete');
    });
});

describe('SCHEDULER_EVENTS', () => {
    it('has scheduler event names', () => {
        expect(SCHEDULER_EVENTS.EVALUATED).toBe('evaluated');
        expect(SCHEDULER_EVENTS.TRIGGERED).toBe('triggered');
        expect(SCHEDULER_EVENTS.SKIPPED).toBe('skipped');
    });
});

describe('EXECUTION_PROGRESS_EVENTS', () => {
    it('has execution progress event names', () => {
        expect(EXECUTION_PROGRESS_EVENTS.STARTED).toBe('execution.started');
        expect(EXECUTION_PROGRESS_EVENTS.COMPLETED).toBe('execution.completed');
        expect(EXECUTION_PROGRESS_EVENTS.FAILED).toBe('execution.failed');
    });
});

describe('TASK_PROGRESS_EVENTS', () => {
    it('has task progress event names', () => {
        expect(TASK_PROGRESS_EVENTS.STARTED).toBe('task.started');
        expect(TASK_PROGRESS_EVENTS.COMPLETED).toBe('task.completed');
        expect(TASK_PROGRESS_EVENTS.FAILED).toBe('task.failed');
    });
});

describe('Status constants', () => {
    it('has definition statuses', () => {
        expect(DAG_DEFINITION_STATUS).toBeDefined();
    });

    it('has run statuses', () => {
        expect(DAG_RUN_STATUS).toBeDefined();
    });

    it('has task run statuses', () => {
        expect(TASK_RUN_STATUS).toBeDefined();
    });
});
