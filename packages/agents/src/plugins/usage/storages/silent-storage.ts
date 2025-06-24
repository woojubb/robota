import { UsageStorage, UsageStats, AggregatedUsageStats } from '../types';

/**
 * Silent storage implementation for usage statistics (no-op)
 */
export class SilentUsageStorage implements UsageStorage {
    async save(_entry: UsageStats): Promise<void> {
        // Silent mode - do nothing
    }

    async getStats(_conversationId?: string, _timeRange?: { start: Date; end: Date }): Promise<UsageStats[]> {
        // Silent mode - return empty array
        return [];
    }

    async getAggregatedStats(_timeRange?: { start: Date; end: Date }): Promise<AggregatedUsageStats> {
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
                startTime: _timeRange?.start || new Date(),
                endTime: _timeRange?.end || new Date(),
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