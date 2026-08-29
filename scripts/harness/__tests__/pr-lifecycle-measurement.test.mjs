import { describe, expect, it } from 'vitest';

import { compareMeasurements } from '../compare-pr-lifecycle-measurements.mjs';

const pr = (number, title) => ({
  number,
  title,
  state: 'MERGED',
  openedAt: '2026-08-29T08:20:01Z',
  mergedAt: '2026-08-29T08:31:35Z',
  mergeCommit: 'a'.repeat(40),
  labels: [],
});

describe('PR lifecycle measurement comparison', () => {
  it('accepts the representative 2-to-1 lifecycle reduction', () => {
    expect(
      compareMeasurements(
        { prLifecycleCount: 2 },
        { prLifecycleCount: 1, conversionPrCount: 0, conversionPrOpenWaitSeconds: 0 },
      ).ok,
    ).toBe(true);
  });

  it('rejects a candidate that still has a conversion PR', () => {
    expect(() =>
      compareMeasurements(
        { prLifecycleCount: 2, sourcePrs: [pr(2501, 'conversion'), pr(2507, 'implementation')] },
        { prLifecycleCount: 1, conversionPrCount: 1, conversionPrOpenWaitSeconds: 12 },
      ),
    ).toThrow('candidate conversion_pr_count');
  });
});
