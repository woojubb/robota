/**
 * Stats aggregation logic for ExecutionAnalyticsPlugin.
 *
 * Extracted from execution-analytics-plugin.ts to keep each file under 300 lines.
 * @internal
 */
import type { IExecutionStats, IAggregatedExecutionStats } from './types';

/** Compute aggregated analytics across recorded executions. @internal */
export function aggregateExecutionStats(
    stats: IExecutionStats[],
    timeRange?: { start: Date; end: Date }
): IAggregatedExecutionStats {
    if (stats.length === 0) {
        return {
            totalExecutions: 0, successfulExecutions: 0, failedExecutions: 0,
            successRate: 0, averageDuration: 0, totalDuration: 0,
            operationStats: {}, errorStats: {},
            timeRange: timeRange || { start: new Date(), end: new Date() }
        };
    }

    const totalExecutions = stats.length;
    const successfulExecutions = stats.filter(s => s.success).length;
    const failedExecutions = totalExecutions - successfulExecutions;
    const totalDuration = stats.reduce((sum, s) => sum + s.duration, 0);
    const averageDuration = totalDuration / totalExecutions;

    const operationStats: Record<string, {
        count: number; successCount: number; failureCount: number;
        totalDuration: number; averageDuration: number;
    }> = {};

    for (const stat of stats) {
        if (!operationStats[stat.operation]) {
            operationStats[stat.operation] = { count: 0, successCount: 0, failureCount: 0, totalDuration: 0, averageDuration: 0 };
        }
        const opStat = operationStats[stat.operation];
        if (opStat) {
            opStat.count++;
            opStat.totalDuration += stat.duration;
            if (stat.success) opStat.successCount++; else opStat.failureCount++;
        }
    }
    for (const op in operationStats) {
        const opStat = operationStats[op];
        if (opStat && opStat.count > 0) opStat.averageDuration = opStat.totalDuration / opStat.count;
    }

    const errorStats: Record<string, number> = {};
    for (const stat of stats.filter(s => !s.success && s.error)) {
        const errorType = stat.error!.type;
        errorStats[errorType] = (errorStats[errorType] || 0) + 1;
    }

    return {
        totalExecutions, successfulExecutions, failedExecutions,
        successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
        averageDuration, totalDuration, operationStats, errorStats,
        timeRange: timeRange || {
            start: stats[0]?.startTime || new Date(),
            end: stats[stats.length - 1]?.endTime || new Date()
        }
    };
}
