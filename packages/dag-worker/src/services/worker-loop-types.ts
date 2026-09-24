import type { IQueuePort } from '@robota-sdk/dag-core';

/**
 * Leaf type module for the worker loop's public option/result shapes.
 *
 * Split out of `worker-loop-service.ts` so `worker-failure-handler.ts`, `task-outcome-handler.ts`
 * and `task-lease-recovery.ts` can depend on these types without importing back from
 * `worker-loop-service.ts`, which previously created import cycles between it and each of them.
 */

/** Configuration options for the worker loop, including retry and dead-letter policies. */
export interface IWorkerLoopOptions {
  workerId: string;
  leaseDurationMs: number;
  visibilityTimeoutMs: number;
  retryEnabled: boolean;
  deadLetterEnabled?: boolean;
  deadLetterQueue?: IQueuePort;
  maxAttempts: number;
  defaultTimeoutMs: number;
  idleWaitMs?: number;
  /** How often an active attempt checks durable run state for another owner's cancellation. */
  cancellationPollMs?: number;
}

/** Result of a single worker loop iteration. */
export interface IWorkerLoopResult {
  processed: boolean;
  taskRunId?: string;
  retried?: boolean;
}
