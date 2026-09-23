import { describe, expect, it } from 'vitest';

import { parseModelEffort, resolveModelEffort } from './effort-resolution.js';

describe('model effort resolution', () => {
  it('uses the documented flag > environment > settings > preset > model-default order', () => {
    expect(
      resolveModelEffort({
        flag: 'low',
        environment: 'medium',
        settings: 'high',
        preset: 'xhigh',
        modelDefault: 'max',
      }),
    ).toMatchObject({
      requested: 'low',
      effective: 'low',
      source: 'flag',
      disposition: 'applied',
      modelDefault: 'max',
    });
  });

  it('resolves auto to the model default and records that it was not an explicit level', () => {
    expect(resolveModelEffort({ flag: 'auto', modelDefault: 'high' })).toEqual({
      requested: 'auto',
      effective: 'high',
      source: 'flag',
      disposition: 'model-default',
      modelDefault: 'high',
    });
  });

  it('validates external values including auto', () => {
    expect(parseModelEffort('auto')).toBe('auto');
    expect(parseModelEffort('xhigh')).toBe('xhigh');
    expect(parseModelEffort(undefined)).toBeUndefined();
    expect(() => parseModelEffort('turbo', '--effort')).toThrow('Invalid --effort');
  });
});
