import { expect, it } from 'vitest';
import { resolveDagExecutionByteLimits } from '../types/execution-byte-limits.js';

it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, 4_194_305])('rejects invalid trusted limit %s', (maxTextRepeatOutputBytes) => {
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes })).toThrow(RangeError);
});

it('snapshots and freezes host ceilings including zero', () => {
  const source = { maxTextRepeatOutputBytes: 0 };
  const limits = resolveDagExecutionByteLimits(source);
  source.maxTextRepeatOutputBytes = 1;
  expect(limits.maxTextRepeatOutputBytes).toBe(0);
  expect(Object.isFrozen(limits)).toBe(true);
});
