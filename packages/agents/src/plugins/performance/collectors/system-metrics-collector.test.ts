import { describe, it, expect } from 'vitest';
import { NodeSystemMetricsCollector } from './system-metrics-collector';

describe('NodeSystemMetricsCollector', () => {
    const collector = new NodeSystemMetricsCollector();

    describe('getMemoryUsage', () => {
        it('returns memory usage data', async () => {
            const usage = await collector.getMemoryUsage();
            expect(usage).toBeDefined();
            expect(usage!.used).toBeGreaterThan(0);
            expect(usage!.heap.used).toBeGreaterThan(0);
            expect(usage!.heap.total).toBeGreaterThan(0);
        });
    });

    describe('getCPUUsage', () => {
        it('returns CPU usage data', async () => {
            const usage = await collector.getCPUUsage();
            expect(usage).toBeDefined();
            expect(typeof usage!.user).toBe('number');
            expect(typeof usage!.system).toBe('number');
            expect(usage!.percent).toBe(0); // Basic implementation returns 0
        });
    });

    describe('getNetworkStats', () => {
        it('returns undefined (not fully implemented)', async () => {
            const stats = await collector.getNetworkStats();
            expect(stats).toBeUndefined();
        });
    });
});
