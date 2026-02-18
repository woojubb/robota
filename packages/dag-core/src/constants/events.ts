export const RUN_EVENT_PREFIX = 'run';
export const TASK_EVENT_PREFIX = 'task';
export const WORKER_EVENT_PREFIX = 'worker';
export const SCHEDULER_EVENT_PREFIX = 'scheduler';
export const EXECUTION_EVENT_PREFIX = 'execution';

export const RUN_EVENTS = {
    CREATED: 'created',
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
} as const;

export const TASK_EVENTS = {
    CREATED: 'created',
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    UPSTREAM_FAILED: 'upstream_failed',
    SKIPPED: 'skipped',
    CANCELLED: 'cancelled'
} as const;

export const WORKER_EVENTS = {
    LEASE_ACQUIRED: 'lease_acquired',
    HEARTBEAT: 'heartbeat',
    LEASE_EXPIRED: 'lease_expired',
    EXECUTION_COMPLETE: 'execution_complete'
} as const;

export const SCHEDULER_EVENTS = {
    EVALUATED: 'evaluated',
    TRIGGERED: 'triggered',
    SKIPPED: 'skipped'
} as const;

export const EXECUTION_PROGRESS_EVENTS = {
    STARTED: 'execution.started',
    COMPLETED: 'execution.completed',
    FAILED: 'execution.failed'
} as const;

export const TASK_PROGRESS_EVENTS = {
    STARTED: 'task.started',
    COMPLETED: 'task.completed',
    FAILED: 'task.failed'
} as const;
