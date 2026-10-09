import { organizationCanonical } from './canonical.js';
import { OrganizationSchemaError } from './error.js';
import type { IOrganizationBudget, IOrganizationUnits } from './types.js';

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  organizationCanonical(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new OrganizationSchemaError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    throw new OrganizationSchemaError();
  return record;
}

function nonnegativeInteger(value: unknown, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum
  )
    throw new OrganizationSchemaError();
  return value;
}

export function organizationUnits(value: unknown): IOrganizationUnits {
  const data = exactRecord(value, ['tokens', 'timeMs', 'costMicros']);
  return Object.freeze({
    tokens: nonnegativeInteger(data.tokens),
    timeMs: nonnegativeInteger(data.timeMs),
    costMicros: nonnegativeInteger(data.costMicros),
  });
}

export function organizationBudget(value: unknown): IOrganizationBudget {
  const data = exactRecord(value, ['tokens', 'timeMs', 'costMicros', 'concurrency']);
  return Object.freeze({
    tokens: nonnegativeInteger(data.tokens),
    timeMs: nonnegativeInteger(data.timeMs),
    costMicros: nonnegativeInteger(data.costMicros),
    concurrency: nonnegativeInteger(data.concurrency, 1),
  });
}
