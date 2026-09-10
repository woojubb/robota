import { describe, expect, it } from 'vitest';

import { isModelEffort, MODEL_EFFORT_VALUES } from '../provider.js';

describe('model effort contract', () => {
  it('owns the runtime vocabulary used to validate external effort values', () => {
    expect(MODEL_EFFORT_VALUES).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(MODEL_EFFORT_VALUES.every((value) => isModelEffort(value))).toBe(true);
    expect(isModelEffort('invalid')).toBe(false);
    expect(isModelEffort(undefined)).toBe(false);
  });
});
