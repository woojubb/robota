import { RoundtableError } from './errors';
import type { JsonValue } from './types';

/** Validates the persistence boundary and produces a property-order-independent retry identity. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || item === null || ancestors.has(item)) {
      throw new RoundtableError(
        'invalid-config',
        'Persisted state must be finite, acyclic JSON data',
      );
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const values: string[] = [];
        for (let i = 0; i < item.length; i++) values.push(visit(item[i]));
        return `[${values.join(',')}]`;
      }
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new RoundtableError('invalid-config', 'Persisted state must contain plain objects');
      }
      const entries = Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (Reflect.ownKeys(item).length !== entries.length) {
        throw new RoundtableError(
          'invalid-config',
          'Persisted state cannot contain hidden or symbol keys',
        );
      }
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${visit(entry)}`).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return visit(value);
}

export function assertJsonValue(value: unknown): asserts value is JsonValue {
  canonicalJson(value);
}
