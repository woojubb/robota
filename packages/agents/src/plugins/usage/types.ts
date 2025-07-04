/**
 * Usage tracking strategy types
 */
export type UsageTrackingStrategy = 'memory' | 'file' | 'remote' | 'silent';

/**
 * Usage statistics entry
 */
export interface UsageStats {
    conversationId?: string;
    executionId?: string;
    timestamp: Date;
    provider: string;
    model: string;
    tokensUsed: {
        input: number;
        output: number;
        total: number;
    };
    cost?: {
        input: number;
        output: number;
        total: number;
    };
    requestCount: number;
    duration: number; // in milliseconds
    success: boolean;
    toolsUsed?: string[];
    metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Aggregated usage statistics
 */
export interface AggregatedUsageStats {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    totalDuration: number;
    successRate: number;
    providerStats: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
        duration: number;
    }>;
    modelStats: Record<string, {
        requests: number;
        tokens: number;
        cost: number;
        duration: number;
    }>;
    toolStats: Record<string, {
        usageCount: number;
        successCount: number;
        totalDuration: number;
    }>;
    timeRangeStats: {
        startTime: Date;
        endTime: Date;
        period: string; // 'hour', 'day', 'week', 'month'
    };
}

import type { BasePluginOptions } from '../../abstracts/base-plugin';

/**
 * Configuration options for usage plugin
 */
export interface UsagePluginOptions extends BasePluginOptions {
    /** Usage tracking strategy to use */
    strategy: UsageTrackingStrategy;
    /** File path for file strategy */
    filePath?: string;
    /** Remote endpoint for remote strategy */
    remoteEndpoint?: string;
    /** Headers for remote logging */
    remoteHeaders?: Record<string, string>;
    /** Maximum number of usage entries to keep in memory */
    maxEntries?: number;
    /** Whether to track token costs */
    trackCosts?: boolean;
    /** Cost per token rates for different models */
    costRates?: Record<string, { input: number; output: number }>;
    /** Batch size for remote reporting */
    batchSize?: number;
    /** Flush interval for batched reporting in milliseconds */
    flushInterval?: number;
    /** Whether to aggregate statistics */
    aggregateStats?: boolean;
    /** Aggregation interval in milliseconds */
    aggregationInterval?: number;
}

/**
 * Usage storage interface
 */
export interface UsageStorage {
    save(entry: UsageStats): Promise<void>;
    getStats(conversationId?: string, timeRange?: { start: Date; end: Date }): Promise<UsageStats[]>;
    getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedUsageStats>;
    clear(): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}

/**
 * Usage plugin statistics
 */
export interface UsagePluginStats {
    /** Total number of usage entries tracked */
    entriesTracked: number;
    /** Total tokens tracked */
    totalTokens: number;
    /** Total cost tracked */
    totalCost: number;
    /** Current tracking strategy */
    strategy: UsageTrackingStrategy;
    /** Last tracking timestamp */
    lastTrackTime?: Date;
    /** Number of failed tracking attempts */
    failedTracking: number;
} 