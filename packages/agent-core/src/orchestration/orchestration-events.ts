/**
 * Neutral orchestration lifecycle event names (SELFHOST-001).
 *
 * Mirrors the existing `task-events` / `user-events` pattern: a const name set +
 * a prefix + a union type. These are emitted by the framework orchestration
 * mechanism over the existing `IEventService`. The names are pure mechanism —
 * no app-domain identity fields anywhere (TRANS-001 neutrality; enforced by the
 * `orchestration-neutrality` harness scan).
 */
export const ORCHESTRATION_EVENTS = {
  /** An orchestration run began. */
  STARTED: 'started',
  /** A single step began executing. */
  STEP_STARTED: 'step_started',
  /** A single step finished executing. */
  STEP_COMPLETED: 'step_completed',
  /** The orchestration run finished successfully. */
  COMPLETED: 'completed',
  /** The orchestration run failed. */
  FAILED: 'failed',
} as const;

export const ORCHESTRATION_EVENT_PREFIX = 'orchestration' as const;

export type TOrchestrationEvent = (typeof ORCHESTRATION_EVENTS)[keyof typeof ORCHESTRATION_EVENTS];
