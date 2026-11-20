import { z } from 'zod';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import {
  isSnapshotableUniversalValue,
  isUniversalValueEqual,
} from '../utils/universal-value-equal';
import type { TAgentExecutionConfig } from '../interfaces/agent';
import type { IJournalToolBatchPolicy } from '../interfaces/execution-journal';
import type { IToolCall } from '../interfaces/messages';
import type { IToolCallScheduling } from '../interfaces/tool';
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

const validSchedulingEntry = z.tuple([
  z.string(),
  z.object({
    dependsOn: z.array(z.string()).nullish(),
    resources: z.array(z.object({ key: z.string(), access: z.enum(['read', 'write']) })).nullish(),
  }),
]);
const policy = z
  .object({
    version: z.literal(1),
    mode: z.enum(['parallel', 'sequential']),
    maxConcurrency: z.number().int().min(1),
    continueOnError: z.boolean(),
    scheduling: z.array(z.tuple([z.unknown(), z.unknown()])).optional(),
  })
  .strict();

function invalidPolicy(): never {
  throw new ExecutionRecoveryError(
    'EXECUTION_RECOVERY_INVALID',
    'Tool batch policy cannot be recorded',
  );
}

/** Avoid invoking accessors while checking whether the platform can clone a policy value. */
function isCloneProbeData(value: unknown, seen = new WeakSet<object>()): boolean {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return true;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  try {
    let entries: IterableIterator<[unknown, unknown]> | undefined;
    try {
      entries = Map.prototype.entries.call(value);
    } catch {
      /* not a Map */
    }
    if (entries) {
      for (const [key, item] of entries)
        if (!isCloneProbeData(key, seen) || !isCloneProbeData(item, seen)) return false;
    } else {
      let members: IterableIterator<unknown> | undefined;
      try {
        members = Set.prototype.values.call(value);
      } catch {
        /* not a Set */
      }
      if (members) for (const item of members) if (!isCloneProbeData(item, seen)) return false;
    }
    // Structured cloning has special reads for Error fields, even when they are inherited or hidden.
    for (const key of ['name', 'message', 'stack', 'cause', 'errors']) {
      const chain = new Set<object>();
      let current: object | null = value;
      while (current) {
        if (chain.has(current)) return false;
        chain.add(current);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor) {
          if (!('value' in descriptor)) return false;
          if (
            (key === 'name' || key === 'message' || key === 'stack') &&
            descriptor.value !== null &&
            typeof descriptor.value === 'object'
          )
            return false;
          if (!isCloneProbeData(descriptor.value, seen)) return false;
          break;
        }
        current = Object.getPrototypeOf(current);
      }
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) return false;
      if (!('value' in descriptor) || !isCloneProbeData(descriptor.value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function assertCloneablePolicyData(value: unknown): void {
  if (!isCloneProbeData(value)) return invalidPolicy();
  try {
    structuredClone(value);
  } catch {
    return invalidPolicy();
  }
}

/** Read a scheduler field without invoking an own or inherited accessor. */
function dataField(value: object, key: PropertyKey): unknown {
  const visited = new Set<object>();
  let current: object | null = value;
  while (current) {
    if (visited.has(current)) return invalidPolicy();
    visited.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!('value' in descriptor)) return invalidPolicy();
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function sameNativeFunction(value: unknown, reference: unknown): boolean {
  return (
    typeof value === 'function' &&
    typeof reference === 'function' &&
    Function.prototype.toString.call(value) === Function.prototype.toString.call(reference)
  );
}

/** A recoverable policy uses native Map iteration, including for Maps from another realm. */
function mapEntries(
  value: ReadonlyMap<string, IToolCallScheduling>,
): IterableIterator<[string, IToolCallScheduling]> {
  try {
    Map.prototype.has.call(value, undefined);
  } catch {
    return invalidPolicy();
  }
  const visited = new Set<object>();
  let prototype = Object.getPrototypeOf(value);
  while (prototype) {
    if (visited.has(prototype)) return invalidPolicy();
    visited.add(prototype);
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const candidate = constructor && 'value' in constructor ? constructor.value : undefined;
    if (typeof candidate === 'function' && sameNativeFunction(candidate, Map)) {
      const nativePrototype = Object.getOwnPropertyDescriptor(candidate, 'prototype');
      const nativeIterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
      const iterator =
        nativeIterator && 'value' in nativeIterator ? nativeIterator.value : undefined;
      if (
        !nativePrototype ||
        !('value' in nativePrototype) ||
        nativePrototype.value !== prototype ||
        typeof iterator !== 'function' ||
        !sameNativeFunction(iterator, Map.prototype[Symbol.iterator]) ||
        dataField(value, Symbol.iterator) !== iterator
      )
        return invalidPolicy();
      try {
        const probe: unknown = Reflect.apply(iterator, new Map([['key', 'value']]), []);
        if (!probe || typeof probe !== 'object') return invalidPolicy();
        const next = dataField(probe, 'next');
        if (typeof next !== 'function') return invalidPolicy();
        const step: unknown = Reflect.apply(next, probe, []);
        if (!step || typeof step !== 'object') return invalidPolicy();
        const result = Object.getOwnPropertyDescriptor(step, 'value');
        if (
          !result ||
          !('value' in result) ||
          !Array.isArray(result.value) ||
          result.value[0] !== 'key' ||
          result.value[1] !== 'value'
        )
          return invalidPolicy();
        return Reflect.apply(iterator, value, []);
      } catch {
        return invalidPolicy();
      }
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return invalidPolicy();
}

/** Accept only subclass bodies whose instance construction is the default Array behavior. */
function hasMethodOnlySubclass(source: string): boolean {
  const header =
    /^class(?:\s+[$A-Z_a-z][$\w]*)?\s+extends\s+[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*\s*\{/.exec(
      source,
    );
  if (!header || /\bconstructor\b|\\|`|\//.test(source)) return false;
  let depth = 1;
  let start = header[0].length;
  let quote: string | undefined;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '{') {
      if (depth === 1) {
        const method = source.slice(start, index).trim();
        if (!/^(?:(?:static|async|get|set)\s+)*[$A-Z_a-z][$\w]*\s*\([^()]*\)\s*$/.test(method))
          return false;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0)
        return source.slice(start, index).trim() === '' && source.slice(index + 1).trim() === '';
      if (depth === 1) start = index + 1;
    } else if (depth === 1 && (char === ';' || char === '=')) return false;
  }
  return false;
}

/** Accept ordinary array subclasses and other realms only when their relevant behavior is native. */
function hasNativeArrayBehavior(value: object): boolean {
  let prototype = Object.getPrototypeOf(value);
  const prototypes = new Set<object>();
  while (prototype && !Array.isArray(prototype)) {
    if (prototypes.has(prototype)) return false;
    prototypes.add(prototype);
    prototype = Object.getPrototypeOf(prototype);
  }
  if (!prototype) return false;
  const ownValue = (target: object, key: PropertyKey): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const nativeConstructor = ownValue(prototype, 'constructor');
  if (
    typeof nativeConstructor !== 'function' ||
    !sameNativeFunction(nativeConstructor, Array) ||
    ownValue(nativeConstructor, 'prototype') !== prototype
  )
    return false;
  const map = ownValue(prototype, 'map');
  const some = ownValue(prototype, 'some');
  const iterator = ownValue(prototype, Symbol.iterator);
  if (
    typeof map !== 'function' ||
    typeof some !== 'function' ||
    typeof iterator !== 'function' ||
    !sameNativeFunction(map, Array.prototype.map) ||
    !sameNativeFunction(some, Array.prototype.some) ||
    !sameNativeFunction(iterator, Array.prototype[Symbol.iterator]) ||
    dataField(value, 'map') !== map ||
    dataField(value, 'some') !== some ||
    dataField(value, Symbol.iterator) !== iterator
  )
    return false;
  try {
    const sample = [1];
    // Keep the probe independent of any customized Array constructor or species.
    Object.defineProperty(sample, 'constructor', { value: undefined });
    const mapped: unknown = Reflect.apply(map, sample, [(item: number) => item + 1]);
    if (
      !Array.isArray(mapped) ||
      mapped.length !== 1 ||
      mapped[0] !== 2 ||
      Reflect.apply(some, sample, [(item: number) => item === 1]) !== true
    )
      return false;
    const cursor: unknown = Reflect.apply(iterator, sample, []);
    if (!cursor || typeof cursor !== 'object') return false;
    const next = dataField(cursor, 'next');
    if (typeof next !== 'function') return false;
    const step: unknown = Reflect.apply(next, cursor, []);
    if (!step || typeof step !== 'object' || ownValue(step, 'value') !== 1) return false;
  } catch {
    return false;
  }
  const species = Object.getOwnPropertyDescriptor(Array, Symbol.species)?.get;
  let constructor: unknown = dataField(value, 'constructor');
  if (
    typeof constructor !== 'function' ||
    ownValue(constructor, 'prototype') !== Object.getPrototypeOf(value)
  )
    return false;
  const visited = new Set<object>();
  while (typeof constructor === 'function') {
    if (visited.has(constructor)) return false;
    visited.add(constructor);
    const source = Function.prototype.toString.call(constructor);
    const descriptor = Object.getOwnPropertyDescriptor(constructor, Symbol.species);
    if (constructor === nativeConstructor) {
      if (
        !descriptor ||
        !sameNativeFunction(descriptor.get, species) ||
        descriptor.set !== undefined
      )
        return false;
      try {
        return Reflect.apply(descriptor.get!, nativeConstructor, []) === nativeConstructor;
      } catch {
        return false;
      }
    }
    // A custom constructor or species could change the mapped resource array.
    if (descriptor || !hasMethodOnlySubclass(source)) return false;
    constructor = Object.getPrototypeOf(constructor);
  }
  return false;
}

/** Copy an array without reading accessors or discarding custom array behavior. */
function projectArray<T>(value: T, project: (item: unknown) => unknown): T {
  if (!Array.isArray(value)) return value;
  assertCloneablePolicyData(value);
  if (!hasNativeArrayBehavior(value)) return invalidPolicy();
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !('value' in length) || typeof length.value !== 'number') return invalidPolicy();
  const copy: unknown[] = new Array(length.value);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    // Other own properties do not affect the verified native scheduler methods.
    if (typeof key !== 'string') continue;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length.value || String(index) !== key)
      continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return invalidPolicy();
    copy[index] = project(descriptor.value);
  }
  for (let index = 0; index < length.value; index++) {
    if (!Object.hasOwn(value, String(index))) {
      let prototype = Object.getPrototypeOf(value);
      const visited = new Set<object>();
      while (prototype) {
        if (visited.has(prototype) || Object.hasOwn(prototype, String(index)))
          return invalidPolicy();
        visited.add(prototype);
        prototype = Object.getPrototypeOf(prototype);
      }
    }
  }
  // The copy preserves the array's scheduler-visible data; malformed elements stay for validation.
  return copy as T;
}

function projectResource(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  assertCloneablePolicyData(value);
  const key = dataField(value, 'key');
  if (typeof key !== 'string' || !key.trim()) return { key: null, access: null };
  const access = dataField(value, 'access');
  if (access !== 'read' && access !== 'write') return { key, access: null };
  return { key, access };
}

function projectResources(value: unknown): unknown {
  if (Array.isArray(value)) return projectArray(value, projectResource);
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  assertCloneablePolicyData(value);
  // A non-array container with no callable map is refused by the scheduler in the same way.
  if (typeof dataField(value, 'map') !== 'function') return {};
  return invalidPolicy();
}

function projectScheduling<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  assertCloneablePolicyData(value);
  const dependsOn = dataField(value, 'dependsOn');
  const resources = dataField(value, 'resources');
  const projected = {
    ...(dependsOn !== undefined && { dependsOn: projectArray(dependsOn, (item) => item) }),
    ...(resources !== undefined && { resources: projectResources(resources) }),
  };
  // The source API supplies this structural type; the scheduler validates malformed fields.
  return projected as T;
}

function projectSchedulingPair(pair: [string, IToolCallScheduling]): [string, IToolCallScheduling] {
  const copy = projectArray(pair, (item) => item);
  if (copy.length !== 2 || !Object.hasOwn(copy, '0') || !Object.hasOwn(copy, '1'))
    return invalidPolicy();
  return [copy[0], projectScheduling(copy[1])];
}

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
      if (Array.isArray(item)) {
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= item.length ||
          String(index) !== key
        )
          return false;
      }
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

/** Inspect saved policy fields before cloning can invoke accessors or drop properties. */
export function assertRawJournalPolicyRecords(source: unknown): void {
  if (!Array.isArray(source))
    throw new ExecutionRecoveryError('EXECUTION_RECOVERY_INVALID', 'Invalid execution journal');
  for (const key of Reflect.ownKeys(source)) {
    if (key === 'length') continue;
    if (typeof key !== 'string')
      throw new ExecutionRecoveryError('EXECUTION_RECOVERY_INVALID', 'Invalid execution journal');
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= source.length ||
      String(index) !== key
    )
      throw new ExecutionRecoveryError('EXECUTION_RECOVERY_INVALID', 'Invalid execution journal');
  }
  for (let index = 0; index < source.length; index++) {
    const item = Object.getOwnPropertyDescriptor(source, String(index));
    const record: unknown = item && 'value' in item ? item.value : undefined;
    if (!item?.enumerable || !record || typeof record !== 'object')
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Invalid execution journal record',
      );
    const kind = Object.getOwnPropertyDescriptor(record, 'kind');
    if (!kind?.enumerable || !('value' in kind))
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Invalid execution journal record kind',
      );
    if (kind.value !== 'tool-intent' && kind.value !== 'tool-result') continue;
    const saved = Object.getOwnPropertyDescriptor(record, 'batchPolicy');
    if (!saved) {
      let prototype = Object.getPrototypeOf(record);
      const visited = new Set<object>();
      while (prototype) {
        if (visited.has(prototype))
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'Invalid journal prototype',
          );
        visited.add(prototype);
        if (Object.hasOwn(prototype, 'batchPolicy'))
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_INVALID',
            'Invalid inherited tool batch policy',
          );
        prototype = Object.getPrototypeOf(prototype);
      }
      continue;
    }
    if (
      !saved.enumerable ||
      !('value' in saved) ||
      (saved.value !== undefined && !isPolicyData(saved.value))
    )
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Invalid raw tool batch policy',
      );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Canonicalize policy details whose ordering or nullish defaults do not affect the scheduler. */
function normalizeScheduling(
  value: Array<[unknown, unknown]> | undefined,
  knownIds: ReadonlySet<string>,
): Array<[unknown, unknown]> | undefined {
  if (value === undefined || new Set(value.map(([id]) => id)).size !== value.length)
    return undefined;
  const entries: Array<[unknown, unknown]> = [];
  let sortable = true;
  for (const original of value) {
    const parsed = validSchedulingEntry.safeParse(original);
    if (!parsed.success) {
      sortable = false;
      const [id, raw] = original;
      if (isPlainObject(raw)) {
        const { dependsOn, resources } = raw;
        const normalizedResources = Array.isArray(resources)
          ? resources.map((resource: unknown) => {
              if (!isPlainObject(resource)) return resource;
              const { key, access } = resource;
              return { ...(key !== undefined && { key }), ...(access !== undefined && { access }) };
            })
          : resources;
        entries.push([
          id,
          {
            ...(dependsOn != null && { dependsOn }),
            ...(normalizedResources != null && { resources: normalizedResources }),
          },
        ]);
      } else entries.push(original);
      continue;
    }
    const [id, entry] = parsed.data;
    const originalDependencies = entry.dependsOn ?? [];
    const hasUnknownDependency = originalDependencies.some(
      (dependency) => !knownIds.has(dependency),
    );
    const dependsOn = hasUnknownDependency
      ? originalDependencies
      : [...new Set(originalDependencies)].sort();
    let resources = entry.resources ?? undefined;
    if (resources?.every((resource) => resource.key.trim().length > 0)) {
      const seen = new Set<string>();
      resources = resources.filter((resource) => {
        const identity = `${resource.key}\u0000${resource.access}`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    }
    resources?.sort((left, right) => {
      const a = `${left.key}\u0000${left.access}`;
      const b = `${right.key}\u0000${right.access}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    if (
      !knownIds.has(id) ||
      hasUnknownDependency ||
      resources?.some((resource) => !resource.key.trim())
    )
      sortable = false;
    if (knownIds.has(id) && dependsOn.length === 0 && resources === undefined) continue;
    entries.push([id, { dependsOn, ...(resources !== undefined && { resources }) }]);
  }
  if (sortable)
    entries.sort(([left], [right]) =>
      typeof left === 'string' && typeof right === 'string'
        ? left < right
          ? -1
          : left > right
            ? 1
            : 0
        : 0,
    );
  return entries;
}

/** Parse durable policy at the journal boundary, rejecting unsupported or ambiguous versions. */
export function parseBatchPolicy(
  value: unknown,
  callIds: readonly (string | undefined)[],
): IJournalToolBatchPolicy {
  if (!isSnapshotableUniversalValue(value) || !isPolicyData(value)) {
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
    const supplied =
      batch.scheduling === undefined
        ? undefined
        : Array.from(mapEntries(batch.scheduling), projectSchedulingPair);
    if (!isPolicyData(supplied))
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_INVALID',
        'Tool batch policy cannot be recorded',
      );
    const detached = structuredClone(supplied);
    // A cyclic policy cannot be recovered by the journal reader's JSON comparison.
    JSON.stringify(detached);
    const detachedScheduling = detached === undefined ? undefined : new Map(detached);
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
