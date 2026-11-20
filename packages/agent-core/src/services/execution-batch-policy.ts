import { z } from 'zod';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import type { IJournalToolBatchPolicy } from '../interfaces/execution-journal';
import type { IToolCallScheduling } from '../interfaces/tool';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';

const scheduling = z
  .object({
    dependsOn: z.array(z.string()),
    resources: z
      .array(
        z
          .object({
            key: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            access: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
const policy = z
  .object({
    version: z.literal(1),
    mode: z.enum(['parallel', 'sequential']),
    maxConcurrency: z.number().int().min(1),
    continueOnError: z.boolean(),
    scheduling: z
      .array(z.tuple([z.string(), scheduling]))
      .refine((entries) => new Set(entries.map(([id]) => id)).size === entries.length)
      .optional(),
  })
  .strict();

/** Parse durable policy at the journal boundary, rejecting unsupported or ambiguous versions. */
export function parseBatchPolicy(value: unknown): IJournalToolBatchPolicy {
  const parsed = policy.safeParse(value);
  if (!parsed.success) {
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Invalid saved tool batch policy',
    );
  }
  const result = parsed.data;
  for (const [, entry] of result.scheduling ?? []) {
    entry.dependsOn.sort();
    if (
      entry.resources?.every(
        (resource) =>
          typeof resource.key === 'string' &&
          (resource.access === 'read' || resource.access === 'write'),
      )
    ) {
      entry.resources.sort((left, right) => {
        const a = `${left.key}\u0000${left.access}`;
        const b = `${right.key}\u0000${right.access}`;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    }
  }
  result.scheduling?.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return result;
}

/** Freeze only values the scheduler uses, then use the same detached values for dispatch. */
export function snapshotBatchPolicy(batch: IToolExecutionBatchContext): IJournalToolBatchPolicy {
  const count = Math.max(1, batch.requests.length);
  const requested = batch.maxConcurrency;
  const concurrency =
    batch.mode === 'sequential'
      ? 1
      : requested === undefined || !Number.isFinite(requested)
        ? count
        : Math.min(count, Math.max(1, Math.floor(requested)));
  try {
    const detachedScheduling =
      batch.scheduling === undefined
        ? undefined
        : new Map<string, IToolCallScheduling>(
            Array.from(batch.scheduling, ([id, value]) => [
              id,
              {
                dependsOn: [...(value.dependsOn ?? [])],
                ...(value.resources !== undefined && {
                  resources: value.resources.map(({ key, access }) => ({ key, access })),
                }),
              },
            ]),
          );
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
