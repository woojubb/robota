import { describe, expect, it } from 'vitest';

import { compareMeasurements } from '../compare-pr-lifecycle-measurements.mjs';

describe('compare-pr-lifecycle-measurements', () => {
  it('exports the comparison boundary', () => {
    expect(compareMeasurements).toBeTypeOf('function');
  });
});
