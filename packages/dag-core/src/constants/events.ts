/** Event name prefix for DAG run lifecycle events. */
export const RUN_EVENT_PREFIX = 'run';
/** Event name prefix for task lifecycle events. */
export const TASK_EVENT_PREFIX = 'task';
/** Event name prefix for worker lifecycle events. */
export const WORKER_EVENT_PREFIX = 'worker';
/** Event name prefix for scheduler lifecycle events. */
export const SCHEDULER_EVENT_PREFIX = 'scheduler';
/** Event name prefix for execution progress events. */
export const EXECUTION_EVENT_PREFIX = 'execution';

/** DAG run lifecycle event names. */
export const RUN_EVENTS = {
    CREATED: 'created',
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
} as const;

/** Task lifecycle event names. */
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

/** Worker lifecycle event names. */
export const WORKER_EVENTS = {
    LEASE_ACQUIRED: 'lease_acquired',
    HEARTBEAT: 'heartbeat',
    LEASE_EXPIRED: 'lease_expired',
    EXECUTION_COMPLETE: 'execution_complete'
} as const;

/** Scheduler lifecycle event names. */
export const SCHEDULER_EVENTS = {
    EVALUATED: 'evaluated',
    TRIGGERED: 'triggered',
    SKIPPED: 'skipped'
} as const;

/** Execution-level progress event names. */
export const EXECUTION_PROGRESS_EVENTS = {
    STARTED: 'execution.started',
    COMPLETED: 'execution.completed',
    FAILED: 'execution.failed'
} as const;

/** Task-level progress event names. */
export const TASK_PROGRESS_EVENTS = {
    STARTED: 'task.started',
    COMPLETED: 'task.completed',
    FAILED: 'task.failed'
} as const;
