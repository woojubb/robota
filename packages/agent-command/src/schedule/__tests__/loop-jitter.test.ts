import { describe, expect, it } from 'vitest';

import { jitterFixedLoop } from '../loop-jitter.js';

describe('fixed-loop jitter', () => {
  it('is stable for a loop identity and stays within half of a short interval', () => {
    const cadence = { description: '5m', milliseconds: 300_000, cronExpression: '0 */5 * * * *' };
    const first = jitterFixedLoop('loop_stable', cadence);
    expect(jitterFixedLoop('loop_stable', cadence)).toEqual(first);
    expect(first.jitterSeconds).toBeGreaterThanOrEqual(0);
    expect(first.jitterSeconds).toBeLessThanOrEqual(150);
    expect(first.cronExpression).toMatch(/^\d+ (?:\*\/5|\d+-59\/5) \* \* \* \*$/);
  });

  it('never adds more than 30 minutes to an hourly or daily slot', () => {
    for (const cadence of [
      { description: '2h', milliseconds: 7_200_000, cronExpression: '0 0 */2 * * *' },
      { description: '24h', milliseconds: 86_400_000, cronExpression: '0 0 0 * * *' },
    ]) {
      const result = jitterFixedLoop('loop_stable', cadence);
      expect(result.jitterSeconds).toBeLessThanOrEqual(1_800);
      expect(result.cronExpression).toMatch(/^\d+ \d+ (?:\*\/2|0) \* \* \*$/);
    }
  });
});
