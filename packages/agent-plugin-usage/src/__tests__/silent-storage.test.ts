import { describe, it, expect } from 'vitest';
import { SilentUsageStorage } from '../storages/silent-storage';
import type { IUsageStats } from '../types';

describe('SilentUsageStorage', () => {
  const storage = new SilentUsageStorage();

  const entry: IUsageStats = {
    provider: 'openai',
    model: 'gpt-4',
    tokensUsed: { input: 100, output: 50, total: 150 },
    requestCount: 1,
    duration: 500,
    success: true,
    timestamp: new Date(),
  };

  it('save is a no-op', async () => {
    await expect(storage.save(entry)).resolves.toBeUndefined();
  });

  it('getStats returns empty array', async () => {
    const stats = await storage.getStats();
    expect(stats).toEqual([]);
  });

  it('getAggregatedStats returns zeroed aggregation', async () => {
    const agg = await storage.getAggregatedStats();
    expect(agg.totalRequests).toBe(0);
    expect(agg.totalTokens).toBe(0);
  });

  it('clear is a no-op', async () => {
    await expect(storage.clear()).resolves.toBeUndefined();
  });

  it('flush is a no-op', async () => {
    await expect(storage.flush()).resolves.toBeUndefined();
  });

  it('close is a no-op', async () => {
    await expect(storage.close()).resolves.toBeUndefined();
  });
});
