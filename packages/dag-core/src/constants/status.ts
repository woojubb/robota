export const DAG_DEFINITION_STATUS = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    DEPRECATED: 'deprecated'
} as const;

export const DAG_RUN_STATUS = {
    CREATED: 'created',
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
} as const;

export const TASK_RUN_STATUS = {
    CREATED: 'created',
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    UPSTREAM_FAILED: 'upstream_failed',
    SKIPPED: 'skipped',
    CANCELLED: 'cancelled'
} as const;
