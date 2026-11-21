import { z } from 'zod';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isUniversalValueEqual } from '../utils/universal-value-equal';
import type { TAgentExecutionConfig } from '../interfaces/agent';
import type { IJournalToolBatchPolicy } from '../interfaces/execution-journal';
import type { IToolCall } from '../interfaces/messages';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';

export type TBatchScheduling = Pick<
  IToolExecutionBatchContext,
  'mode' | 'maxConcurrency' | 'continueOnError' | 'scheduling'
>;

const resource = z
  .object({
    key: z.string().refine((key) => key.trim().length > 0),
    access: z.enum(['read', 'write']),
  })
  .strict();
const declaration = z
  .object({
    dependsOn: z.array(z.string()).optional(),
    resources: z.array(resource).optional(),
  })
  .strict();
const savedDeclaration = z
  .object({
    dependsOn: z.array(z.string()),
    resources: z.array(resource).optional(),
  })
  .strict();
const savedPolicy = z
  .object({
    version: z.literal(1),
    mode: z.enum(['parallel', 'sequential']),
    maxConcurrency: z.number().int().min(1),
    continueOnError: z.boolean(),
    scheduling: z.array(z.tuple([z.string(), savedDeclaration])).optional(),
  })
  .strict();

const mapEntries = Map.prototype.entries;
const mapHas = Map.prototype.has;
const mapIterator = Map.prototype[Symbol.iterator];
const arrayMap = Array.prototype.map;
const arraySome = Array.prototype.some;
const arrayEvery = Array.prototype.every;
const arrayIterator = Array.prototype[Symbol.iterator];
const arraySpecies = Object.getOwnPropertyDescriptor(Array, Symbol.species)?.get;

function invalid(message: string): never {
  throw new ExecutionRecoveryError('EXECUTION_RECOVERY_INVALID', message);
}

function assertSchedulingIntrinsics(): void {
  if (
    Map.prototype.entries !== mapEntries ||
    Map.prototype.has !== mapHas ||
    Map.prototype[Symbol.iterator] !== mapIterator ||
    mapIterator !== mapEntries ||
    Array.prototype.map !== arrayMap ||
    Array.prototype.some !== arraySome ||
    Array.prototype.every !== arrayEvery ||
    Array.prototype[Symbol.iterator] !== arrayIterator ||
    Array.prototype.constructor !== Array ||
    Object.getOwnPropertyDescriptor(Array, Symbol.species)?.get !== arraySpecies ||
    [
      'version',
      'mode',
      'maxConcurrency',
      'continueOnError',
      'scheduling',
      'dependsOn',
      'resources',
      'key',
      'access',
    ].some((key) => Object.hasOwn(Object.prototype, key) || Object.hasOwn(Array.prototype, key))
  )
    invalid('Runtime scheduling intrinsics changed');
}

/** Capture data descriptors once so user objects cannot change what the scheduler later reads. */
function copyPlainData(
  value: unknown,
  copies = new WeakMap<object, unknown>(),
  active = new WeakSet<object>(),
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value !== 'object' || active.has(value))
    invalid('Tool batch policy must be plain cloneable data');
  if (copies.has(value)) return copies.get(value);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype))
    invalid('Tool batch policy must be plain cloneable data');
  const length = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : undefined;
  if (array && (!Number.isSafeInteger(length) || length < 0))
    invalid('Tool batch policy must be plain cloneable data');
  const keys = Reflect.ownKeys(value);
  const descriptors = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(value, key)] as const,
  );
  const copy: Record<string, unknown> | unknown[] = array ? new Array(length) : {};
  copies.set(value, copy);
  active.add(value);
  let count = 0;
  for (const [key, descriptor] of descriptors) {
    if (array && key === 'length') continue;
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    )
      invalid('Tool batch policy must be plain cloneable data');
    if (array) {
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key)
        invalid('Tool batch policy must be plain cloneable data');
      count++;
    }
    Object.defineProperty(copy, key, {
      value: copyPlainData(descriptor.value, copies, active),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  active.delete(value);
  if (array && count !== length) invalid('Tool batch policy must be plain cloneable data');
  return copy;
}

function clonePlainData(value: unknown): unknown {
  try {
    const copy = copyPlainData(value);
    assertSchedulingIntrinsics();
    return copy;
  } catch (error) {
    if (error instanceof ExecutionRecoveryError) throw error;
    return invalid('Tool batch policy must be plain cloneable data');
  }
}

/** Inspect saved policy fields before an outer clone can invoke accessors or drop properties. */
export function assertRawJournalPolicyRecords(source: unknown): void {
  if (!Array.isArray(source)) invalid('Invalid execution journal');
  const length = Object.getOwnPropertyDescriptor(source, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) invalid('Invalid execution journal');
  for (const key of Reflect.ownKeys(source)) {
    if (key === 'length') continue;
    if (typeof key !== 'string') invalid('Invalid execution journal');
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key)
      invalid('Invalid execution journal');
  }
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(source, String(index));
    const record: unknown = item && 'value' in item ? item.value : undefined;
    if (!item?.enumerable || !record || typeof record !== 'object')
      invalid('Invalid execution journal record');
    const kind = Object.getOwnPropertyDescriptor(record, 'kind');
    if (!kind?.enumerable || !('value' in kind)) invalid('Invalid execution journal record kind');
    if (kind.value !== 'tool-intent' && kind.value !== 'tool-result') continue;
    const saved = Object.getOwnPropertyDescriptor(record, 'batchPolicy');
    if (!saved) {
      let prototype = Object.getPrototypeOf(record);
      const visited = new Set<object>();
      while (prototype) {
        if (visited.has(prototype) || Object.hasOwn(prototype, 'batchPolicy'))
          invalid('Invalid inherited tool batch policy');
        visited.add(prototype);
        prototype = Object.getPrototypeOf(prototype);
      }
      continue;
    }
    if (!saved.enumerable || !('value' in saved)) invalid('Invalid raw tool batch policy');
    if (saved.value !== undefined) clonePlainData(saved.value);
  }
}

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
  if (saved && !isUniversalValueEqual(saved, current))
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_CONFLICT',
      'Active tool batch policy differs from the saved policy',
    );
}

function normalizedPolicy(
  policy: IJournalToolBatchPolicy,
  callIds: readonly (string | undefined)[],
): IJournalToolBatchPolicy {
  if (!policy.scheduling) return policy;
  const known = new Set(callIds.filter((id): id is string => typeof id === 'string'));
  const seen = new Set<string>();
  let sortable = true;
  const entries: NonNullable<IJournalToolBatchPolicy['scheduling']> = [];
  for (const [id, entry] of policy.scheduling) {
    if (seen.has(id)) invalid('Duplicate scheduling call identity');
    seen.add(id);
    const unknown = entry.dependsOn.some((dependency) => !known.has(dependency));
    const dependsOn = unknown ? entry.dependsOn : [...new Set(entry.dependsOn)].sort();
    const resources =
      entry.resources &&
      [
        ...new Map(
          entry.resources.map((item) => [`${item.key}\u0000${item.access}`, item]),
        ).values(),
      ].sort((left, right) => {
        const a = `${left.key}\u0000${left.access}`;
        const b = `${right.key}\u0000${right.access}`;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    if (!known.has(id) || unknown) sortable = false;
    if (known.has(id) && dependsOn.length === 0 && resources === undefined) continue;
    entries.push([id, { dependsOn, ...(resources !== undefined && { resources }) }]);
  }
  if (sortable) entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return { ...policy, scheduling: entries };
}

export function parseBatchPolicy(
  value: unknown,
  callIds: readonly (string | undefined)[],
): IJournalToolBatchPolicy {
  assertSchedulingIntrinsics();
  const parsed = savedPolicy.safeParse(clonePlainData(value));
  if (!parsed.success) invalid('Invalid saved tool batch policy');
  return normalizedPolicy(parsed.data, callIds);
}

/** Bind the scheduler to the same detached data that is saved before dispatch. */
export function snapshotBatchPolicy(
  batch: TBatchScheduling,
  callIds: readonly (string | undefined)[],
): IJournalToolBatchPolicy {
  assertSchedulingIntrinsics();
  const count = Math.max(1, callIds.length);
  const requested = batch.maxConcurrency;
  const concurrency =
    batch.mode === 'sequential'
      ? 1
      : requested === undefined || !Number.isFinite(requested)
        ? count
        : Math.min(count, Math.max(1, Math.floor(requested)));
  let scheduling: Array<[string, z.infer<typeof declaration>]> | undefined;
  if (batch.scheduling !== undefined) {
    try {
      mapHas.call(batch.scheduling, undefined);
    } catch {
      invalid('Journaled scheduling requires a native Map');
    }
    if (
      Object.getPrototypeOf(batch.scheduling) !== Map.prototype ||
      Reflect.ownKeys(batch.scheduling).length > 0
    )
      invalid('Journaled scheduling requires a native Map with standard iteration');
    const raw = Array.from(mapEntries.call(batch.scheduling));
    const parsed = z.array(z.tuple([z.string(), declaration])).safeParse(clonePlainData(raw));
    if (!parsed.success) invalid('Journaled scheduling requires plain data declarations');
    scheduling = parsed.data;
    batch.scheduling = new Map(scheduling);
  }
  batch.maxConcurrency = concurrency;
  batch.continueOnError = batch.continueOnError ?? false;
  return parseBatchPolicy(
    {
      version: 1,
      mode: batch.mode,
      maxConcurrency: concurrency,
      continueOnError: batch.continueOnError,
      ...(scheduling && {
        scheduling: scheduling.map(([id, item]) => [
          id,
          {
            dependsOn: item.dependsOn ?? [],
            ...(item.resources !== undefined && { resources: item.resources }),
          },
        ]),
      }),
    },
    callIds,
  );
}
