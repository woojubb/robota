import { ExecutionRecoveryError } from './execution-recovery-error';

/** Request identities cover finite plain JSON, never functions or live runtime objects. */
export function continuationJson(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== 'object' || ancestors.has(item)) invalid();
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return `[${Array.from(item, visit).join(',')}]`;
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        invalid();
      const entries = Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (entries.length !== Reflect.ownKeys(item).length) invalid();
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${visit(entry)}`).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return visit(value);
}

export function continuationObject(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  continuationJson(value);
}

function invalid(): never {
  throw new ExecutionRecoveryError(
    'EXECUTION_RECOVERY_INVALID',
    'Tool continuations require finite plain JSON objects',
  );
}
