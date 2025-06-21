import { UsageStorage, UsageStats, AggregatedUsageStats } from '../types.js';

/**
 * Memory storage implementation for usage statistics
 */
export class MemoryUsageStorage implements UsageStorage {
    private entries: UsageStats[] = [];
    private maxEntries: number;

    constructor(maxEntries: number = 10000) {
        this.maxEntries = maxEntries;
    }

    async save(entry: UsageStats): Promise<void> {
        // Remove oldest entries if limit exceeded
        if (this.entries.length >= this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries + 1);
        }

        this.entries.push({ ...entry });
    }

    async getStats(conversationId?: string, timeRange?: { start: Date; end: Date }): Promise<UsageStats[]> {
        let filtered = [...this.entries];

        if (conversationId) {
            filtered = filtered.filter(entry => entry.conversationId === conversationId);
        }

        if (timeRange) {
            filtered = filtered.filter(entry =>
                entry.timestamp >= timeRange.start && entry.timestamp <= timeRange.end
            );
        }

        return filtered;
    }

    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedUsageStats> {
        const stats = await this.getStats(undefined, timeRange);

        const aggregated: AggregatedUsageStats = {
            totalRequests: stats.length,
            totalTokens: stats.reduce((sum, entry) => sum + entry.tokensUsed.total, 0),
            totalCost: stats.reduce((sum, entry) => sum + (entry.cost?.total || 0), 0),
            totalDuration: stats.reduce((sum, entry) => sum + entry.duration, 0),
            successRate: stats.length > 0 ? stats.filter(entry => entry.success).length / stats.length : 0,
            providerStats: {},
            modelStats: {},
            toolStats: {},
            timeRangeStats: {
                startTime: timeRange?.start || (stats.length > 0 ? stats[0].timestamp : new Date()),
                endTime: timeRange?.end || (stats.length > 0 ? stats[stats.length - 1].timestamp : new Date()),
                period: this.determinePeriod(timeRange)
            }
        };

        // Aggregate by provider
        for (const entry of stats) {
            if (!aggregated.providerStats[entry.provider]) {
                aggregated.providerStats[entry.provider] = {
                    requests: 0,
                    tokens: 0,
                    cost: 0,
                    duration: 0
                };
            }
            const providerStat = aggregated.providerStats[entry.provider];
            providerStat.requests += entry.requestCount;
            providerStat.tokens += entry.tokensUsed.total;
            providerStat.cost += entry.cost?.total || 0;
            providerStat.duration += entry.duration;
        }

        // Aggregate by model
        for (const entry of stats) {
            if (!aggregated.modelStats[entry.model]) {
                aggregated.modelStats[entry.model] = {
                    requests: 0,
                    tokens: 0,
                    cost: 0,
                    duration: 0
                };
            }
            const modelStat = aggregated.modelStats[entry.model];
            modelStat.requests += entry.requestCount;
            modelStat.tokens += entry.tokensUsed.total;
            modelStat.cost += entry.cost?.total || 0;
            modelStat.duration += entry.duration;
        }

        // Aggregate by tools
        for (const entry of stats) {
            if (entry.toolsUsed) {
                for (const tool of entry.toolsUsed) {
                    if (!aggregated.toolStats[tool]) {
                        aggregated.toolStats[tool] = {
                            usageCount: 0,
                            successCount: 0,
                            totalDuration: 0
                        };
                    }
                    const toolStat = aggregated.toolStats[tool];
                    toolStat.usageCount += 1;
                    if (entry.success) {
                        toolStat.successCount += 1;
                    }
                    toolStat.totalDuration += entry.duration;
                }
            }
        }

        return aggregated;
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

    private determinePeriod(timeRange?: { start: Date; end: Date }): string {
        if (!timeRange) return 'all';

        const diff = timeRange.end.getTime() - timeRange.start.getTime();
        const hours = diff / (1000 * 60 * 60);

        if (hours <= 1) return 'hour';
        if (hours <= 24) return 'day';
        if (hours <= 168) return 'week'; // 24 * 7
        return 'month';
    }
} 