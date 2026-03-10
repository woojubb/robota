import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryUsageStorage } from './memory-storage';
import type { IUsageStats } from '../types';

function makeEntry(overrides: Partial<IUsageStats> = {}): IUsageStats {
    return {
        provider: 'openai',
        model: 'gpt-4',
        tokensUsed: { input: 100, output: 50, total: 150 },
        requestCount: 1,
        duration: 500,
        success: true,
        timestamp: new Date(),
        ...overrides
    };
}

describe('MemoryUsageStorage', () => {
    let storage: MemoryUsageStorage;

    beforeEach(() => {
        storage = new MemoryUsageStorage(100);
    });

    it('saves and retrieves entries', async () => {
        await storage.save(makeEntry());
        const stats = await storage.getStats();
        expect(stats).toHaveLength(1);
    });

    it('evicts oldest entries when maxEntries exceeded', async () => {
        storage = new MemoryUsageStorage(3);
        await storage.save(makeEntry({ provider: 'first' }));
        await storage.save(makeEntry({ provider: 'second' }));
        await storage.save(makeEntry({ provider: 'third' }));
        await storage.save(makeEntry({ provider: 'fourth' }));
        const stats = await storage.getStats();
        expect(stats).toHaveLength(3);
        // First entry should be evicted
        expect(stats.some(s => s.provider === 'first')).toBe(false);
        expect(stats.some(s => s.provider === 'fourth')).toBe(true);
    });

    it('filters by conversationId', async () => {
        await storage.save(makeEntry({ conversationId: 'conv-1' }));
        await storage.save(makeEntry({ conversationId: 'conv-2' }));
        const stats = await storage.getStats('conv-1');
        expect(stats).toHaveLength(1);
        expect(stats[0].conversationId).toBe('conv-1');
    });

    it('filters by time range', async () => {
        const old = new Date('2024-01-01');
        const recent = new Date('2025-06-01');
        await storage.save(makeEntry({ timestamp: old }));
        await storage.save(makeEntry({ timestamp: recent }));
        const stats = await storage.getStats(undefined, {
            start: new Date('2025-01-01'),
            end: new Date('2026-01-01')
        });
        expect(stats).toHaveLength(1);
    });

    it('returns aggregated stats', async () => {
        await storage.save(makeEntry({ success: true }));
        await storage.save(makeEntry({ success: false }));
        const aggregated = await storage.getAggregatedStats();
        expect(aggregated.totalRequests).toBe(2);
        expect(aggregated.successRate).toBe(0.5);
    });

    it('clears all entries', async () => {
        await storage.save(makeEntry());
        await storage.clear();
        const stats = await storage.getStats();
        expect(stats).toHaveLength(0);
    });

    it('flush and close are no-ops', async () => {
        await expect(storage.flush()).resolves.toBeUndefined();
        await expect(storage.close()).resolves.toBeUndefined();
    });
});
