import { IUsageStorage, IUsageStats, IAggregatedUsageStats } from '../types';
import { aggregateUsageStats } from '../aggregate-usage-stats';

/**
 * Silent storage implementation for usage statistics (no-op)
 */
export class SilentUsageStorage implements IUsageStorage {
    async save(_entry: IUsageStats): Promise<void> {
        // Silent mode - do nothing
    }

    async getStats(_conversationId?: string, _timeRange?: { start: Date; end: Date }): Promise<IUsageStats[]> {
        // Silent mode - return empty array
        return [];
    }

    async getAggregatedStats(_timeRange?: { start: Date; end: Date }): Promise<IAggregatedUsageStats> {
        return aggregateUsageStats([], _timeRange);
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