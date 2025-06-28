/**
 * Performance monitoring strategy types
 */
export type PerformanceMonitoringStrategy = 'memory' | 'file' | 'prometheus' | 'remote' | 'silent';

/**
 * Performance metrics entry
 */
export interface PerformanceMetrics {
    executionId?: string;
    conversationId?: string;
    timestamp: Date;
    operation: string; // 'conversation', 'tool_execution', 'provider_call', etc.
    duration: number; // in milliseconds
    memoryUsage?: {
        used: number;
        free: number;
        total: number;
        heap: {
            used: number;
            total: number;
        };
    };
    cpuUsage?: {
        user: number;
        system: number;
        percent: number;
    };
    networkStats?: {
        requests: number;
        bytesReceived: number;
        bytesSent: number;
        latency: number;
    };
    errorCount: number;
    success: boolean;
    metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Aggregated performance statistics
 */
export interface AggregatedPerformanceStats {
    totalOperations: number;
    averageDuration: number;
    minDuration: number;
    maxDuration: number;
    successRate: number;
    errorRate: number;
    memoryStats?: {
        averageUsed: number;
        maxUsed: number;
        averageHeapUsed: number;
        maxHeapUsed: number;
    };
    cpuStats?: {
        averagePercent: number;
        maxPercent: number;
    };
    networkStats?: {
        totalRequests: number;
        totalBytesReceived: number;
        totalBytesSent: number;
        averageLatency: number;
    };
    operationStats: Record<string, {
        count: number;
        averageDuration: number;
        successRate: number;
        errorCount: number;
    }>;
    timeRangeStats: {
        startTime: Date;
        endTime: Date;
        period: string;
    };
}

/**
 * Configuration options for performance plugin
 */
export interface PerformancePluginOptions {
    /** Performance monitoring strategy to use */
    strategy: PerformanceMonitoringStrategy;
    /** File path for file strategy */
    filePath?: string;
    /** Remote endpoint for remote strategy */
    remoteEndpoint?: string;
    /** Prometheus endpoint for prometheus strategy */
    prometheusEndpoint?: string;
    /** Headers for remote monitoring */
    remoteHeaders?: Record<string, string>;
    /** Maximum number of performance entries to keep in memory */
    maxEntries?: number;
    /** Whether to monitor memory usage */
    monitorMemory?: boolean;
    /** Whether to monitor CPU usage */
    monitorCPU?: boolean;
    /** Whether to monitor network stats */
    monitorNetwork?: boolean;
    /** Batch size for remote reporting */
    batchSize?: number;
    /** Flush interval for batched reporting in milliseconds */
    flushInterval?: number;
    /** Whether to aggregate statistics */
    aggregateStats?: boolean;
    /** Aggregation interval in milliseconds */
    aggregationInterval?: number;
    /** Performance threshold in milliseconds to log warnings */
    performanceThreshold?: number;
}

/**
 * Performance storage interface
 */
export interface PerformanceStorage {
    save(entry: PerformanceMetrics): Promise<void>;
    getMetrics(operation?: string, timeRange?: { start: Date; end: Date }): Promise<PerformanceMetrics[]>;
    getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedPerformanceStats>;
    clear(): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}

/**
 * System metrics collector interface
 */
export interface SystemMetricsCollector {
    getMemoryUsage(): Promise<PerformanceMetrics['memoryUsage']>;
    getCPUUsage(): Promise<PerformanceMetrics['cpuUsage']>;
    getNetworkStats(): Promise<PerformanceMetrics['networkStats']>;
} 