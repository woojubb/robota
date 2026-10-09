import { describe, expect, it } from 'vitest';
import { organizationBudget, organizationUnits } from '@robota-sdk/agent-organization';
import { OrganizationRefused } from '../index.js';
import { budget, units } from '../verification.js';

describe('public resource validation adapter', () => {
  it('returns the same validated snapshots', () => {
    const resource = { tokens: 1, timeMs: 2, costMicros: 3 };
    expect(units(resource)).toEqual(organizationUnits(resource));
    expect(budget({ ...resource, concurrency: 1 })).toEqual(
      organizationBudget({ ...resource, concurrency: 1 }),
    );
  });

  it('preserves owner refusal identity for invalid resources', () => {
    expect(() => units({ tokens: -0, timeMs: 0, costMicros: 0 })).toThrow(OrganizationRefused);
    expect(() => budget({ tokens: 0, timeMs: 0, costMicros: 0, concurrency: 0 })).toThrow(
      OrganizationRefused,
    );
  });
});
