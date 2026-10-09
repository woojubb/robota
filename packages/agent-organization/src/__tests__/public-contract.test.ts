import { describe, expect, it } from 'vitest';
import {
  OrganizationSchemaError,
  organizationBudget,
  organizationCanonical,
  organizationUnits,
} from '../index.js';
import type { IOrganizationBudget, IOrganizationUnits } from '../index.js';

describe('public organization contracts', () => {
  it('keeps canonical bytes stable for nested keys and Unicode', () => {
    expect(organizationCanonical({ '😀': ['Amber', 1], '\uE000': 'Cedar', a: true })).toBe(
      '{"a":true,"😀":["Amber",1],"":"Cedar"}',
    );
  });

  it('validates exact, frozen unit and budget snapshots', () => {
    const source = { tokens: 1, timeMs: 2, costMicros: 3 };
    const units: IOrganizationUnits = organizationUnits(source);
    const budget: IOrganizationBudget = organizationBudget({
      tokens: 1,
      timeMs: 2,
      costMicros: 3,
      concurrency: 1,
    });
    expect(units).toEqual({ tokens: 1, timeMs: 2, costMicros: 3 });
    expect(budget).toEqual({ tokens: 1, timeMs: 2, costMicros: 3, concurrency: 1 });
    expect(Object.isFrozen(units)).toBe(true);
    expect(Object.isFrozen(budget)).toBe(true);
    source.tokens = 99;
    expect(units.tokens).toBe(1);
  });

  it('enforces UTF-8 output, depth and node bounds', () => {
    expect(organizationCanonical('a'.repeat(65_534))).toHaveLength(65_536);
    expect(() => organizationCanonical('a'.repeat(65_535))).toThrow(OrganizationSchemaError);
    expect(() => organizationCanonical([Array(4_095).fill(null)])).toThrow(
      OrganizationSchemaError,
    );
    let nested: unknown = null;
    for (let index = 0; index < 33; index++) nested = [nested];
    expect(() => organizationCanonical(nested)).toThrow(OrganizationSchemaError);
  });

  it.each([
    () => organizationUnits({ tokens: -0, timeMs: 0, costMicros: 0 }),
    () => organizationUnits({ tokens: 0.5, timeMs: 0, costMicros: 0 }),
    () => organizationUnits({ tokens: 0, timeMs: 0, costMicros: 0, extra: 1 }),
    () => organizationBudget({ tokens: 0, timeMs: 0, costMicros: 0, concurrency: 0 }),
    () => organizationBudget({ tokens: 0, timeMs: 0, costMicros: 0, concurrency: 1, extra: 1 }),
  ])('rejects invalid values without coercion (%#)', (validate) => {
    expect(OrganizationSchemaError).toBeTypeOf('function');
    expect(validate).toThrow(OrganizationSchemaError);
  });
});
