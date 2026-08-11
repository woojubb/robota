import { describe, it, expect } from 'vitest';

import {
  DEFAULT_CONTEXT_WINDOW,
  getModelContextWindow,
  getModelName,
  formatTokenCount,
} from './models.js';

/**
 * NEUT-010: the Claude table these tests used to assert against now lives with the package that
 * owns those models (`agent-provider-anthropic`), and its cases moved with it. What stays here is
 * what this vendor-NEUTRAL package still owns: the fallback behaviour when nobody has registered a
 * model, and token formatting.
 *
 * Registry behaviour — registration, override, and the no-longer-silent fallback — is covered in
 * `model-registry.test.ts`.
 */
describe('getModelContextWindow', () => {
  it('falls back for a model nobody registered', () => {
    expect(getModelContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe('getModelName', () => {
  it('returns the model ID for a model nobody registered', () => {
    expect(getModelName('unknown-model')).toBe('unknown-model');
  });
});

describe('formatTokenCount', () => {
  it('formats millions with uppercase M', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(2_000_000)).toBe('2M');
  });

  it('formats thousands with uppercase K', () => {
    expect(formatTokenCount(1_000)).toBe('1K');
    expect(formatTokenCount(200_000)).toBe('200K');
    expect(formatTokenCount(90_000)).toBe('90K');
  });

  it('formats fractional millions with 1 decimal', () => {
    expect(formatTokenCount(1_186_891)).toBe('1.2M');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
    expect(formatTokenCount(2_300_000)).toBe('2.3M');
  });

  it('formats fractional thousands with 1 decimal', () => {
    expect(formatTokenCount(1_500)).toBe('1.5K');
    expect(formatTokenCount(90_500)).toBe('90.5K');
  });

  it('drops trailing zero in decimal', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(2_000_000)).toBe('2M');
    expect(formatTokenCount(100_000)).toBe('100K');
  });

  it('shows <1K for values below 1000', () => {
    expect(formatTokenCount(500)).toBe('<1K');
    expect(formatTokenCount(1)).toBe('<1K');
    expect(formatTokenCount(999)).toBe('<1K');
  });

  it('shows 0K for zero', () => {
    expect(formatTokenCount(0)).toBe('0K');
  });
});
