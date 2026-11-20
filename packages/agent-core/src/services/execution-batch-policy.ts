import { z } from 'zod';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import {
  isSnapshotableUniversalValue,
  isUniversalValueEqual,
} from '../utils/universal-value-equal';
import type { TAgentExecutionConfig } from '../interfaces/agent';
import type { IJournalToolBatchPolicy } from '../interfaces/execution-journal';
import type { IToolCall } from '../interfaces/messages';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';

export type TBatchScheduling = Pick<
  IToolExecutionBatchContext,
  'mode' | 'maxConcurrency' | 'continueOnError' | 'scheduling'
>;

export function resolveBatchScheduling(
  calls: IToolCall[],
  config?: TAgentExecutionConfig,
): TBatchScheduling {
  const selected = config?.toolExecutionPolicy?.(structuredClone(calls));
  return {
    mode: selected?.mode ?? 'parallel',
    maxConcurrency: selected?.maxConcurrency ?? 5,
    continueOnError: selected?.continueOnError ?? true,
    scheduling: selected?.scheduling ?? new Map(),
  };
}

export function assertSavedBatchPolicy(
  current: IJournalToolBatchPolicy,
  saved?: IJournalToolBatchPolicy,
): void {
  if (saved && !isUniversalValueEqual(saved, current)) {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_CONFLICT',
      'Active tool batch policy differs from the saved policy',
    );
  }
}

const validScheduling = z.array(
  z.tuple([
    z.string(),
    z.object({
      dependsOn: z.array(z.string()).default([]),
      resources: z
        .array(z.object({ key: z.string(), access: z.enum(['read', 'write']) }))
        .optional(),
    }),
  ]),
);
const policy = z
  .object({
    version: z.literal(1),
    mode: z.enum(['parallel', 'sequential']),
    maxConcurrency: z.number().int().min(1),
    continueOnError: z.boolean(),
    scheduling: z.array(z.tuple([z.unknown(), z.unknown()])).optional(),
  })
  .strict();

/** Parse durable policy at the journal boundary, rejecting unsupported or ambiguous versions. */
export function parseBatchPolicy(value: unknown): IJournalToolBatchPolicy {
  if (!isSnapshotableUniversalValue(value)) {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Tool batch policy cannot be represented in the journal',
    );
  }
  const parsed = policy.safeParse(value);
  if (!parsed.success) {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Invalid saved tool batch policy',
    );
  }
  const result = parsed.data;
  const valid = validScheduling.safeParse(result.scheduling);
  if (valid.success && new Set(valid.data.map(([id]) => id)).size === valid.data.length) {
    for (const [, entry] of valid.data) {
      entry.dependsOn.sort();
      entry.resources?.sort((left, right) => {
        const a = `${left.key}\u0000${left.access}`;
        const b = `${right.key}\u0000${right.access}`;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    }
    valid.data.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    result.scheduling = valid.data;
  }
  return result;
}

/** Freeze only values the scheduler uses, then use the same detached values for dispatch. */
export function snapshotBatchPolicy(
  batch: TBatchScheduling,
  requestCount: number,
): IJournalToolBatchPolicy {
  const count = Math.max(1, requestCount);
  const requested = batch.maxConcurrency;
  const concurrency =
    batch.mode === 'sequential'
      ? 1
      : requested === undefined || !Number.isFinite(requested)
        ? count
        : Math.min(count, Math.max(1, Math.floor(requested)));
  try {
    const supplied = batch.scheduling === undefined ? undefined : Array.from(batch.scheduling);
    const valid = validScheduling.safeParse(supplied);
    const schedulingEntries = valid.success ? valid.data : supplied;
    if (!isSnapshotableUniversalValue(schedulingEntries))
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Tool batch policy cannot be recorded',
      );
    // A cyclic policy cannot be recovered by the journal reader's JSON comparison.
    JSON.stringify(schedulingEntries);
    const detachedScheduling =
      schedulingEntries === undefined ? undefined : new Map(structuredClone(schedulingEntries));
    const snapshot = parseBatchPolicy({
      version: 1,
      mode: batch.mode,
      maxConcurrency: concurrency,
      continueOnError: batch.continueOnError ?? false,
      ...(detachedScheduling !== undefined && {
        scheduling: Array.from(detachedScheduling),
      }),
    });
    batch.maxConcurrency = snapshot.maxConcurrency;
    batch.continueOnError = snapshot.continueOnError;
    batch.scheduling = detachedScheduling;
    return snapshot;
  } catch (error) {
    if (error instanceof ExecutionRecoveryError) throw error;
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Tool batch policy cannot be recorded',
    );
  }
}
