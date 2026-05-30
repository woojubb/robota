import { describe, expect, it } from 'vitest';
import { calculateCost, formatTokens, formatUsd } from '../model-pricing.js';

describe('calculateCost', () => {
  it('returns exact cost for known Anthropic Sonnet model', () => {
    const cost = calculateCost('claude-sonnet-4-5', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 5);
  });

  it('returns exact cost for known Anthropic Opus model', () => {
    const cost = calculateCost('claude-opus-4-7', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(15 + 75, 5);
  });

  it('calculates fractional token costs correctly', () => {
    const cost = calculateCost('claude-sonnet-4-5', 45_000, 12_000);
    expect(cost).toBeDefined();
    expect(cost!).toBeCloseTo((45_000 / 1_000_000) * 3 + (12_000 / 1_000_000) * 15, 8);
  });

  it('falls back to pattern matching for claude-sonnet variant', () => {
    const cost = calculateCost('claude-sonnet-99-99', 1_000_000, 0);
    expect(cost).toBeCloseTo(3, 5);
  });

  it('falls back to pattern matching for deepseek variant', () => {
    const cost = calculateCost('deepseek-v3-turbo', 1_000_000, 0);
    expect(cost).toBeDefined();
  });

  it('returns undefined for completely unknown model', () => {
    const cost = calculateCost('unknown-model-xyz-123', 1_000, 1_000);
    expect(cost).toBeUndefined();
  });

  it('returns zero cost when both token counts are zero', () => {
    const cost = calculateCost('claude-sonnet-4-5', 0, 0);
    expect(cost).toBe(0);
  });
});

describe('formatUsd', () => {
  it('formats small amounts with 4 decimal places', () => {
    expect(formatUsd(0.0043)).toBe('$0.0043');
  });

  it('formats sub-dollar amounts with 3 decimal places', () => {
    expect(formatUsd(0.187)).toBe('$0.187');
  });

  it('formats dollar+ amounts with 2 decimal places', () => {
    expect(formatUsd(1.24)).toBe('$1.24');
  });
});

describe('formatTokens', () => {
  it('formats token counts with comma separators', () => {
    expect(formatTokens(45000)).toBe('45,000');
  });

  it('formats small counts without separator', () => {
    expect(formatTokens(999)).toBe('999');
  });
});
