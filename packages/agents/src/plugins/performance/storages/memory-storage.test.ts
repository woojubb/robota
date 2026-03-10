import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPerformanceStorage } from './memory-storage';
import type { IPerformanceMetrics } from '../types';

function makeMetric(overrides: Partial<IPerformanceMetrics> = {}): IPerformanceMetrics {
    return {
        operation: 'test-op',
        duration: 100,
        success: true,
        errorCount: 0,
        timestamp: new Date(),
        ...overrides
    };
}

describe('MemoryPerformanceStorage', () => {
    let storage: MemoryPerformanceStorage;

    beforeEach(() => {
        storage = new MemoryPerformanceStorage(100);
    });

    it('saves and retrieves entries', async () => {
        await storage.save(makeMetric());
        const metrics = await storage.getMetrics();
        expect(metrics).toHaveLength(1);
    });

    it('evicts oldest when maxEntries exceeded', async () => {
        storage = new MemoryPerformanceStorage(2);
        await storage.save(makeMetric({ operation: 'first' }));
        await storage.save(makeMetric({ operation: 'second' }));
        await storage.save(makeMetric({ operation: 'third' }));
        const metrics = await storage.getMetrics();
        expect(metrics).toHaveLength(2);
        expect(metrics.some(m => m.operation === 'first')).toBe(false);
    });

    it('filters by operation', async () => {
        await storage.save(makeMetric({ operation: 'op-a' }));
        await storage.save(makeMetric({ operation: 'op-b' }));
        const metrics = await storage.getMetrics('op-a');
        expect(metrics).toHaveLength(1);
        expect(metrics[0].operation).toBe('op-a');
    });

    it('filters by time range', async () => {
        await storage.save(makeMetric({ timestamp: new Date('2024-01-01') }));
        await storage.save(makeMetric({ timestamp: new Date('2025-06-01') }));
        const metrics = await storage.getMetrics(undefined, {
            start: new Date('2025-01-01'),
            end: new Date('2026-01-01')
        });
        expect(metrics).toHaveLength(1);
    });

    it('returns aggregated stats', async () => {
        await storage.save(makeMetric({ duration: 100, success: true, errorCount: 0 }));
        await storage.save(makeMetric({ duration: 300, success: false, errorCount: 2 }));
        const stats = await storage.getAggregatedStats();
        expect(stats.totalOperations).toBe(2);
        expect(stats.averageDuration).toBe(200);
        expect(stats.minDuration).toBe(100);
        expect(stats.maxDuration).toBe(300);
        expect(stats.successRate).toBe(0.5);
        expect(stats.errorRate).toBe(1);
    });

    it('returns zeroed aggregated stats for empty data', async () => {
        const stats = await storage.getAggregatedStats();
        expect(stats.totalOperations).toBe(0);
        expect(stats.averageDuration).toBe(0);
    });

    it('clear removes all entries', async () => {
        await storage.save(makeMetric());
        await storage.clear();
        const metrics = await storage.getMetrics();
        expect(metrics).toHaveLength(0);
    });

    it('flush and close are no-ops', async () => {
        await expect(storage.flush()).resolves.toBeUndefined();
        await expect(storage.close()).resolves.toBeUndefined();
    });
});
