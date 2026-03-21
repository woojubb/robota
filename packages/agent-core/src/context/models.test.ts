import { describe, it, expect } from 'vitest';
import {
  CLAUDE_MODELS,
  DEFAULT_CONTEXT_WINDOW,
  getModelContextWindow,
  getModelName,
  formatTokenCount,
} from './models.js';

describe('CLAUDE_MODELS registry', () => {
  it('contains known model IDs', () => {
    expect(CLAUDE_MODELS['claude-opus-4-6']).toBeDefined();
    expect(CLAUDE_MODELS['claude-sonnet-4-6']).toBeDefined();
    expect(CLAUDE_MODELS['claude-haiku-4-5']).toBeDefined();
  });

  it('each entry has required fields', () => {
    for (const [id, model] of Object.entries(CLAUDE_MODELS)) {
      expect(model.id).toBe(id);
      expect(model.name).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxOutput).toBeGreaterThan(0);
    }
  });
});

describe('getModelContextWindow', () => {
  it('returns context window for known model', () => {
    expect(getModelContextWindow('claude-opus-4-6')).toBe(1_000_000);
    expect(getModelContextWindow('claude-haiku-4-5')).toBe(200_000);
  });

  it('returns DEFAULT_CONTEXT_WINDOW for unknown model', () => {
    expect(getModelContextWindow('unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe('getModelName', () => {
  it('returns human-readable name for known model', () => {
    expect(getModelName('claude-opus-4-6')).toBe('Claude Opus 4.6');
    expect(getModelName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
  });

  it('returns model ID as fallback for unknown model', () => {
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
