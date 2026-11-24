/** Fingerprints that do not depend on the order a record's fields were written in. */
import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));

export const digestOf = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
