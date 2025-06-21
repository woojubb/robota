import { PerformanceStorage, PerformanceMetrics, AggregatedPerformanceStats } from '../types.js';

export class MemoryPerformanceStorage implements PerformanceStorage {
    private entries: PerformanceMetrics[] = [];
    private maxEntries: number;

    constructor(maxEntries: number = 5000) {
        this.maxEntries = maxEntries;
    }

    async save(entry: PerformanceMetrics): Promise<void> {
        if (this.entries.length >= this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries + 1);
        }
        this.entries.push({ ...entry });
    }

    async getMetrics(operation?: string, timeRange?: { start: Date; end: Date }): Promise<PerformanceMetrics[]> {
        let filtered = [...this.entries];
        if (operation) {
            filtered = filtered.filter(entry => entry.operation === operation);
        }
        if (timeRange) {
            filtered = filtered.filter(entry =>
                entry.timestamp >= timeRange.start && entry.timestamp <= timeRange.end
            );
        }
        return filtered;
    }

    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedPerformanceStats> {
        const metrics = await this.getMetrics(undefined, timeRange);

        if (metrics.length === 0) {
            return {
                totalOperations: 0,
                averageDuration: 0,
                minDuration: 0,
                maxDuration: 0,
                successRate: 0,
                errorRate: 0,
                operationStats: {},
                timeRangeStats: {
                    startTime: timeRange?.start || new Date(),
                    endTime: timeRange?.end || new Date(),
                    period: 'empty'
                }
            };
        }

        const durations = metrics.map(m => m.duration);
        const successCount = metrics.filter(m => m.success).length;
        const errorCount = metrics.reduce((sum, m) => sum + m.errorCount, 0);

        return {
            totalOperations: metrics.length,
            averageDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
            minDuration: Math.min(...durations),
            maxDuration: Math.max(...durations),
            successRate: successCount / metrics.length,
            errorRate: errorCount / metrics.length,
            operationStats: {},
            timeRangeStats: {
                startTime: timeRange?.start || metrics[0].timestamp,
                endTime: timeRange?.end || metrics[metrics.length - 1].timestamp,
                period: 'memory'
            }
        };
    }

    async clear(): Promise<void> {
        this.entries = [];
    }

    async flush(): Promise<void> {
        // Memory storage doesn't need flushing
    }

    async close(): Promise<void> {
        // Memory storage doesn't need closing
    }
} 