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
      dependsOn: z.array(z.string()).nullish(),
      resources: z
        .array(z.object({ key: z.string(), access: z.enum(['read', 'write']) }))
        .nullish(),
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

/** Policy data may be frozen, but accessors and lossy properties must never be read. */
function isPolicyData(value: unknown): boolean {
  const active = new WeakSet<object>();
  const seen = new WeakSet<object>();
  const keys = ['dependsOn', 'resources', 'key', 'access'];
  if (
    keys.some((key) => Object.hasOwn(Object.prototype, key) || Object.hasOwn(Array.prototype, key))
  )
    return false;
  const visit = (item: unknown): boolean => {
    if (
      item === null ||
      item === undefined ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
    )
      return true;
    if (typeof item !== 'object' || active.has(item)) return false;
    if (seen.has(item)) return true;
    seen.add(item);
    if (item instanceof Date)
      return Object.getPrototypeOf(item) === Date.prototype && Reflect.ownKeys(item).length === 0;
    if (Object.getPrototypeOf(item) !== (Array.isArray(item) ? Array.prototype : Object.prototype))
      return false;
    active.add(item);
    const valid = Reflect.ownKeys(item).every((key) => {
      if (Array.isArray(item) && key === 'length') return true;
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      return (
        !!descriptor && descriptor.enumerable && 'value' in descriptor && visit(descriptor.value)
      );
    });
    active.delete(item);
    return valid;
  };
  return visit(value);
}

/** Canonicalize policy details whose ordering or nullish defaults do not affect the scheduler. */
function normalizeScheduling(
  value: unknown,
  knownIds: ReadonlySet<string>,
):
  | Array<
      [
        string,
        {
          dependsOn: string[];
          resources?: Array<{ key: string; access: 'read' | 'write' }>;
        },
      ]
    >
  | undefined {
  const valid = validScheduling.safeParse(value);
  if (!valid.success || new Set(valid.data.map(([id]) => id)).size !== valid.data.length)
    return undefined;
  const entries = valid.data.map(
    ([id, entry]): [
      string,
      {
        dependsOn: string[];
        resources?: Array<{ key: string; access: 'read' | 'write' }>;
      },
    ] => [
      id,
      {
        dependsOn: (entry.dependsOn ?? []).sort(),
        ...(entry.resources != null && {
          resources: entry.resources.sort((left, right) => {
            const a = `${left.key}\u0000${left.access}`;
            const b = `${right.key}\u0000${right.access}`;
            return a < b ? -1 : a > b ? 1 : 0;
          }),
        }),
      },
    ],
  );
  const effective = entries.filter(
    ([id, entry]) =>
      !(knownIds.has(id) && entry.dependsOn.length === 0 && entry.resources === undefined),
  );
  effective.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return effective;
}

/** Parse durable policy at the journal boundary, rejecting unsupported or ambiguous versions. */
export function parseBatchPolicy(
  value: unknown,
  callIds: readonly (string | undefined)[],
): IJournalToolBatchPolicy {
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
  const knownIds = new Set(callIds.filter((id): id is string => typeof id === 'string'));
  const normalized = normalizeScheduling(result.scheduling, knownIds);
  if (normalized) result.scheduling = normalized;
  return result;
}

/** Freeze only values the scheduler uses, then use the same detached values for dispatch. */
export function snapshotBatchPolicy(
  batch: TBatchScheduling,
  callIds: readonly (string | undefined)[],
): IJournalToolBatchPolicy {
  const count = Math.max(1, callIds.length);
  const requested = batch.maxConcurrency;
  const concurrency =
    batch.mode === 'sequential'
      ? 1
      : requested === undefined || !Number.isFinite(requested)
        ? count
        : Math.min(count, Math.max(1, Math.floor(requested)));
  try {
    const supplied = batch.scheduling === undefined ? undefined : Array.from(batch.scheduling);
    if (!isPolicyData(supplied))
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Tool batch policy cannot be recorded',
      );
    const detached = structuredClone(supplied);
    const knownIds = new Set(callIds.filter((id): id is string => typeof id === 'string'));
    const schedulingEntries = normalizeScheduling(detached, knownIds) ?? detached;
    // A cyclic policy cannot be recovered by the journal reader's JSON comparison.
    JSON.stringify(schedulingEntries);
    const detachedScheduling =
      schedulingEntries === undefined ? undefined : new Map(structuredClone(schedulingEntries));
    const snapshot = parseBatchPolicy(
      {
        version: 1,
        mode: batch.mode,
        maxConcurrency: concurrency,
        continueOnError: batch.continueOnError ?? false,
        ...(detachedScheduling !== undefined && {
          scheduling: Array.from(detachedScheduling),
        }),
      },
      callIds,
    );
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
