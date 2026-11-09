import { createHash } from 'node:crypto';

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

  it('offsets each loop by the first four bytes of the SHA-256 of its id, as node:crypto reads them', () => {
    const cadence = { description: '60m', milliseconds: 3_600_000, cronExpression: '0 0 * * * *' };
    const ids = [
      'loop_00000000-0000-4000-8000-000000000000',
      'loop_123e4567-e89b-42d3-a456-426614174000',
      'loop_ünïcödé-日本語-🧪',
      'loop_lone-surrogate-\ud800-x',
      '',
      ...Array.from({ length: 200 }, (_, index) => `loop_${index}`),
    ];
    const maxSeconds = Math.floor(Math.min(30 * 60, cadence.milliseconds / 2_000));
    for (const id of ids) {
      const expected = createHash('sha256').update(id).digest().readUInt32BE(0) % (maxSeconds + 1);
      expect(jitterFixedLoop(id, cadence).jitterSeconds, id).toBe(expected);
    }
  });
});
