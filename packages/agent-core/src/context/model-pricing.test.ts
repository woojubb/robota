import { describe, expect, it } from 'vitest';
import {
  calculateModelCost,
  estimateBlendedCostPer1000,
  lookupModelPrice,
} from './model-pricing.js';

describe('lookupModelPrice', () => {
  it('resolves an exact model ID', () => {
    expect(lookupModelPrice('claude-sonnet-4-5')).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
  });

  it('falls back to family pattern for an unknown variant', () => {
    expect(lookupModelPrice('claude-sonnet-99-99')).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
  });

  it('returns undefined for a completely unknown model', () => {
    expect(lookupModelPrice('unknown-model-xyz-123')).toBeUndefined();
  });
});

describe('calculateModelCost', () => {
  it('computes exact input/output cost for a known model', () => {
    expect(calculateModelCost('claude-opus-4-7', 1_000_000, 1_000_000)).toBeCloseTo(15 + 75, 5);
  });

  it('computes fractional cost', () => {
    expect(calculateModelCost('claude-sonnet-4-5', 45_000, 12_000)).toBeCloseTo(
      (45_000 / 1_000_000) * 3 + (12_000 / 1_000_000) * 15,
      8,
    );
  });

  it('returns undefined for an unknown model', () => {
    expect(calculateModelCost('unknown-model-xyz-123', 1_000, 1_000)).toBeUndefined();
  });
});

describe('estimateBlendedCostPer1000', () => {
  it('averages input and output per-million into a per-1000 rate', () => {
    // gpt-4o: (2.5 + 10) / 2 / 1000
    expect(estimateBlendedCostPer1000('gpt-4o')).toBeCloseTo(0.00625, 8);
  });

  it('returns undefined for an unknown model so callers can apply a fallback rate', () => {
    expect(estimateBlendedCostPer1000('unknown-model-xyz-123')).toBeUndefined();
  });
});
