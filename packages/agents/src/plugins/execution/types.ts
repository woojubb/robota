/**
 * Analytics context data for execution tracking
 */
export interface AnalyticsContextData {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    operation?: string;
    toolName?: string;
    parameterCount?: number;
    inputLength?: number;
    responseLength?: number;
    hasOptions?: boolean;
    hasError?: boolean;
    resultType?: string;
    errorSource?: string;
    contextType?: string;
    hasContext?: boolean;
    modelName?: string;
}

/**
 * Execution statistics entry
 */
export interface ExecutionStats {
    executionId: string;
    operation: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    success: boolean;
    error?: {
        message: string;
        stack?: string;
        type: string;
    };
    metadata?: Record<string, string | number | boolean | Date | string[]>;
}

/**
 * Aggregated execution statistics
 */
export interface AggregatedExecutionStats {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    averageDuration: number;
    totalDuration: number;
    operationStats: Record<string, {
        count: number;
        successCount: number;
        failureCount: number;
        averageDuration: number;
        totalDuration: number;
    }>;
    errorStats: Record<string, number>;
    timeRange: {
        start: Date;
        end: Date;
    };
}

import type { BasePluginOptions } from '../../abstracts/base-plugin';

/**
 * Plugin options
 */
export interface ExecutionAnalyticsOptions extends BasePluginOptions {
    /** Maximum number of entries to keep in memory */
    maxEntries?: number;
    /** Whether to track error details */
    trackErrors?: boolean;
    /** Performance threshold in milliseconds for warnings */
    performanceThreshold?: number;
    /** Enable performance warnings */
    enableWarnings?: boolean;
}

/**
 * Execution analytics plugin statistics
 */
export interface ExecutionAnalyticsPluginStats {
    /** Total number of executions recorded */
    totalRecorded: number;
    /** Number of active executions */
    activeExecutions: number;
    /** Memory usage in KB */
    memoryUsage: number;
    /** Oldest record timestamp */
    oldestRecord?: Date;
    /** Newest record timestamp */
    newestRecord?: Date;
} 