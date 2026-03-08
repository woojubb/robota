import type { IAggregatedUsageStats, IUsageStats } from './types';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_HOUR = MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK = 168;

interface IUsageTimeRange {
    start: Date;
    end: Date;
}

function determineUsagePeriod(timeRange: IUsageTimeRange | undefined): string {
    if (!timeRange) return 'all';

    const diff = timeRange.end.getTime() - timeRange.start.getTime();
    const hours = diff / MS_PER_HOUR;

    if (hours <= 1) return 'hour';
    if (hours <= HOURS_PER_DAY) return 'day';
    if (hours <= HOURS_PER_WEEK) return 'week';
    return 'month';
}

function resolveTimeRangeStats(
    stats: readonly IUsageStats[],
    timeRange: IUsageTimeRange | undefined
): { startTime: Date; endTime: Date; period: string } {
    if (timeRange) {
        return {
            startTime: timeRange.start,
            endTime: timeRange.end,
            period: determineUsagePeriod(timeRange)
        };
    }

    if (stats.length > 0) {
        const first = stats[0]?.timestamp;
        const last = stats[stats.length - 1]?.timestamp;
        const now = new Date();
        return {
            startTime: first ?? now,
            endTime: last ?? now,
            period: determineUsagePeriod(undefined)
        };
    }

    const now = new Date();
    return {
        startTime: now,
        endTime: now,
        period: determineUsagePeriod(undefined)
    };
}

/**
 * Aggregate usage statistics into a single summary object.
 * This is a shared SSOT utility (composition over inheritance).
 */
export function aggregateUsageStats(
    stats: readonly IUsageStats[],
    timeRange?: IUsageTimeRange
): IAggregatedUsageStats {
    const timeRangeStats = resolveTimeRangeStats(stats, timeRange);

    const aggregated: IAggregatedUsageStats = {
        totalRequests: stats.length,
        totalTokens: stats.reduce((sum, entry) => sum + entry.tokensUsed.total, 0),
        totalCost: stats.reduce((sum, entry) => sum + (entry.cost?.total ?? 0), 0),
        totalDuration: stats.reduce((sum, entry) => sum + entry.duration, 0),
        successRate: stats.length > 0 ? stats.filter((entry) => entry.success).length / stats.length : 0,
        providerStats: {},
        modelStats: {},
        toolStats: {},
        timeRangeStats
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
        if (providerStat) {
            providerStat.requests += entry.requestCount;
            providerStat.tokens += entry.tokensUsed.total;
            providerStat.cost += entry.cost?.total ?? 0;
            providerStat.duration += entry.duration;
        }
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
        if (modelStat) {
            modelStat.requests += entry.requestCount;
            modelStat.tokens += entry.tokensUsed.total;
            modelStat.cost += entry.cost?.total ?? 0;
            modelStat.duration += entry.duration;
        }
    }

    // Aggregate by tools
    for (const entry of stats) {
        const toolsUsed = entry.toolsUsed;
        if (!toolsUsed) continue;

        for (const tool of toolsUsed) {
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

    return aggregated;
}


