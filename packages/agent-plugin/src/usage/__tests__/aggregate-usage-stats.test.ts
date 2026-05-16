import { describe, it, expect } from 'vitest';
import { aggregateUsageStats } from '../aggregate-usage-stats';
import type { IUsageStats } from '../types';

function makeEntry(overrides: Partial<IUsageStats> = {}): IUsageStats {
  return {
    provider: 'openai',
    model: 'gpt-4',
    tokensUsed: { input: 100, output: 50, total: 150 },
    requestCount: 1,
    duration: 500,
    success: true,
    timestamp: new Date('2025-01-01T10:00:00Z'),
    ...overrides,
  };
}

describe('aggregateUsageStats', () => {
  it('returns empty aggregation for no entries', () => {
    const result = aggregateUsageStats([]);
    expect(result.totalRequests).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.timeRangeStats.period).toBe('all');
  });

  it('aggregates single entry correctly', () => {
    const entry = makeEntry({ cost: { input: 1, output: 2, total: 3 } });
    const result = aggregateUsageStats([entry]);
    expect(result.totalRequests).toBe(1);
    expect(result.totalTokens).toBe(150);
    expect(result.totalCost).toBe(3);
    expect(result.totalDuration).toBe(500);
    expect(result.successRate).toBe(1);
  });

  it('aggregates multiple entries', () => {
    const entries = [
      makeEntry({ success: true }),
      makeEntry({
        provider: 'anthropic',
        model: 'claude-3',
        success: false,
        tokensUsed: { input: 200, output: 100, total: 300 },
      }),
    ];
    const result = aggregateUsageStats(entries);
    expect(result.totalRequests).toBe(2);
    expect(result.totalTokens).toBe(450);
    expect(result.successRate).toBe(0.5);
  });

  it('aggregates by provider', () => {
    const entries = [
      makeEntry({
        provider: 'openai',
        requestCount: 1,
        tokensUsed: { input: 100, output: 50, total: 150 },
      }),
      makeEntry({
        provider: 'openai',
        requestCount: 2,
        tokensUsed: { input: 200, output: 100, total: 300 },
      }),
      makeEntry({
        provider: 'anthropic',
        requestCount: 1,
        tokensUsed: { input: 50, output: 25, total: 75 },
      }),
    ];
    const result = aggregateUsageStats(entries);
    expect(result.providerStats['openai']?.requests).toBe(3);
    expect(result.providerStats['openai']?.tokens).toBe(450);
    expect(result.providerStats['anthropic']?.requests).toBe(1);
  });

  it('aggregates by model', () => {
    const entries = [
      makeEntry({ model: 'gpt-4', requestCount: 1 }),
      makeEntry({ model: 'gpt-3.5', requestCount: 2 }),
    ];
    const result = aggregateUsageStats(entries);
    expect(result.modelStats['gpt-4']?.requests).toBe(1);
    expect(result.modelStats['gpt-3.5']?.requests).toBe(2);
  });

  it('aggregates by tools', () => {
    const entries = [
      makeEntry({ toolsUsed: ['search', 'calc'], success: true, duration: 100 }),
      makeEntry({ toolsUsed: ['search'], success: false, duration: 200 }),
    ];
    const result = aggregateUsageStats(entries);
    expect(result.toolStats['search']?.usageCount).toBe(2);
    expect(result.toolStats['search']?.successCount).toBe(1);
    expect(result.toolStats['calc']?.usageCount).toBe(1);
  });

  it('determines period from time range', () => {
    const now = new Date();
    const halfHourAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const result = aggregateUsageStats([], { start: halfHourAgo, end: now });
    expect(result.timeRangeStats.period).toBe('hour');
  });

  it('determines day period', () => {
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const result = aggregateUsageStats([], { start: sixHoursAgo, end: now });
    expect(result.timeRangeStats.period).toBe('day');
  });

  it('determines week period', () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const result = aggregateUsageStats([], { start: threeDaysAgo, end: now });
    expect(result.timeRangeStats.period).toBe('week');
  });

  it('determines month period', () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const result = aggregateUsageStats([], { start: twoWeeksAgo, end: now });
    expect(result.timeRangeStats.period).toBe('month');
  });

  it('uses entry timestamps when no time range given', () => {
    const entries = [
      makeEntry({ timestamp: new Date('2025-01-01') }),
      makeEntry({ timestamp: new Date('2025-01-05') }),
    ];
    const result = aggregateUsageStats(entries);
    expect(result.timeRangeStats.startTime).toEqual(new Date('2025-01-01'));
    expect(result.timeRangeStats.endTime).toEqual(new Date('2025-01-05'));
  });
});
