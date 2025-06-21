import { UsageStorage, UsageStats, AggregatedUsageStats } from '../types.js';

/**
 * Silent storage implementation for usage statistics (no-op)
 */
export class SilentUsageStorage implements UsageStorage {
    async save(entry: UsageStats): Promise<void> {
        // Silent mode - do nothing
    }

    async getStats(conversationId?: string, timeRange?: { start: Date; end: Date }): Promise<UsageStats[]> {
        // Silent mode - return empty array
        return [];
    }

    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedUsageStats> {
        // Silent mode - return empty aggregated stats
        return {
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0,
            totalDuration: 0,
            successRate: 0,
            providerStats: {},
            modelStats: {},
            toolStats: {},
            timeRangeStats: {
                startTime: timeRange?.start || new Date(),
                endTime: timeRange?.end || new Date(),
                period: 'silent'
            }
        };
    }

    async clear(): Promise<void> {
        // Silent mode - do nothing
    }

    async flush(): Promise<void> {
        // Silent mode - do nothing
    }

    async close(): Promise<void> {
        // Silent mode - do nothing
    }
} 