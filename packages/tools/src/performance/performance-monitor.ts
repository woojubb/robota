/**
 * Performance Monitor for Tool Performance Tracking
 * 
 * @module performance-monitor
 * @description
 * Provides a system for real-time monitoring of tool performance and collecting metrics.
 */

import { CacheStats } from './cache-manager';
import { LazyLoadStats } from './lazy-loader';
import { ResourceStats } from './resource-manager';

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
    /** Tool call count */
    toolCallCount: number;
    /** Average tool call time (milliseconds) */
    averageCallTime: number;
    /** Maximum tool call time (milliseconds) */
    maxCallTime: number;
    /** Minimum tool call time (milliseconds) */
    minCallTime: number;
    /** Successful calls count */
    successfulCalls: number;
    /** Failed calls count */
    failedCalls: number;
    /** Success rate (0-1) */
    successRate: number;
    /** Throughput (TPS - Transactions Per Second) */
    throughput: number;
    /** Memory usage statistics */
    memoryUsage: MemoryUsageMetrics;
    /** Cache performance statistics */
    cacheMetrics: CacheStats | null;
    /** Lazy loading statistics */
    lazyLoadMetrics: LazyLoadStats | null;
    /** Resource management statistics */
    resourceMetrics: ResourceStats | null;
}

/**
 * Memory usage metrics
 */
export interface MemoryUsageMetrics {
    /** Current heap usage (bytes) */
    currentHeapUsed: number;
    /** Maximum heap usage (bytes) */
    maxHeapUsed: number;
    /** Average heap usage (bytes) */
    averageHeapUsed: number;
    /** External memory usage (bytes) */
    external: number;
    /** RSS (Resident Set Size) */
    rss: number;
}

/**
 * Tool call record
 */
export interface ToolCallRecord {
    /** Tool name */
    toolName: string;
    /** Call start time */
    startTime: number;
    /** Call end time */
    endTime: number;
    /** Execution duration (milliseconds) */
    duration: number;
    /** Success status */
    success: boolean;
    /** Error message (on failure) */
    error?: string;
    /** Parameter size (bytes) */
    parameterSize: number;
    /** Response size (bytes) */
    responseSize: number;
}

/**
 * Performance event listener type
 */
export type PerformanceEventListener = (metrics: PerformanceMetrics) => void;

/**
 * Performance monitor class
 */
export class PerformanceMonitor {
    private callRecords: ToolCallRecord[] = [];
    private memorySnapshots: number[] = [];
    private maxRecords: number;
    private monitoringInterval?: NodeJS.Timeout;
    private eventListeners: PerformanceEventListener[] = [];
    private isMonitoring = false;

    // External statistics sources
    private cacheStatsProvider?: () => CacheStats;
    private lazyLoadStatsProvider?: () => LazyLoadStats;
    private resourceStatsProvider?: () => ResourceStats;

    constructor(options: {
        maxRecords?: number; // default: 10000
        monitoringIntervalMs?: number; // default: 5 seconds
    } = {}) {
        this.maxRecords = options.maxRecords || 10000;

        if (options.monitoringIntervalMs) {
            this.startMonitoring(options.monitoringIntervalMs);
        }
    }

    /**
     * Start monitoring
     */
    startMonitoring(intervalMs: number = 5000): void {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, intervalMs);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(): void {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
    }

    /**
     * Record tool call
     */
    recordToolCall(record: ToolCallRecord): void {
        this.callRecords.push(record);

        // Limit record count
        if (this.callRecords.length > this.maxRecords) {
            const removeCount = Math.floor(this.maxRecords * 0.1); // remove 10%
            this.callRecords.splice(0, removeCount);
        }

        // Collect memory snapshot
        this.collectMemorySnapshot();
    }

    /**
     * Helper for recording tool call start time
     */
    startToolCall(toolName: string, parameters: any): string {
        const callId = `${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const parameterSize = this.estimateObjectSize(parameters);

        // Temporary storage (consider using WeakMap in actual implementation)
        (this as any)._pendingCalls = (this as any)._pendingCalls || new Map();
        (this as any)._pendingCalls.set(callId, {
            toolName,
            startTime: performance.now(),
            parameterSize
        });

        return callId;
    }

    /**
     * Helper for recording tool call completion
     */
    endToolCall(callId: string, success: boolean, response?: any, error?: string): void {
        const pendingCalls = (this as any)._pendingCalls;
        if (!pendingCalls || !pendingCalls.has(callId)) {
            return;
        }

        const pending = pendingCalls.get(callId);
        pendingCalls.delete(callId);

        const endTime = performance.now();
        const responseSize = response ? this.estimateObjectSize(response) : 0;

        this.recordToolCall({
            toolName: pending.toolName,
            startTime: pending.startTime,
            endTime,
            duration: endTime - pending.startTime,
            success,
            error,
            parameterSize: pending.parameterSize,
            responseSize
        });
    }

    /**
     * Register external statistics providers
     */
    setCacheStatsProvider(provider: () => CacheStats): void {
        this.cacheStatsProvider = provider;
    }

    setLazyLoadStatsProvider(provider: () => LazyLoadStats): void {
        this.lazyLoadStatsProvider = provider;
    }

    setResourceStatsProvider(provider: () => ResourceStats): void {
        this.resourceStatsProvider = provider;
    }

    /**
     * Register event listener
     */
    addEventListener(listener: PerformanceEventListener): void {
        this.eventListeners.push(listener);
    }

    /**
     * Remove event listener
     */
    removeEventListener(listener: PerformanceEventListener): void {
        const index = this.eventListeners.indexOf(listener);
        if (index > -1) {
            this.eventListeners.splice(index, 1);
        }
    }

    /**
     * Get current performance metrics
     */
    getMetrics(): PerformanceMetrics {
        const now = performance.now();
        const recentRecords = this.callRecords.filter(
            record => now - record.endTime < 60000 // last 1 minute
        );

        // Calculate basic statistics
        const totalCalls = this.callRecords.length;
        const successfulCalls = this.callRecords.filter(r => r.success).length;
        const failedCalls = totalCalls - successfulCalls;
        const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;

        // Time statistics
        const durations = this.callRecords.map(r => r.duration);
        const averageCallTime = durations.length > 0
            ? durations.reduce((sum, d) => sum + d, 0) / durations.length
            : 0;
        const maxCallTime = durations.length > 0 ? Math.max(...durations) : 0;
        const minCallTime = durations.length > 0 ? Math.min(...durations) : 0;

        // Calculate throughput (last 1 minute)
        const throughput = recentRecords.length / 60; // TPS

        // Memory statistics
        const memoryUsage = this.calculateMemoryMetrics();

        return {
            toolCallCount: totalCalls,
            averageCallTime,
            maxCallTime,
            minCallTime,
            successfulCalls,
            failedCalls,
            successRate,
            throughput,
            memoryUsage,
            cacheMetrics: this.cacheStatsProvider ? this.cacheStatsProvider() : null,
            lazyLoadMetrics: this.lazyLoadStatsProvider ? this.lazyLoadStatsProvider() : null,
            resourceMetrics: this.resourceStatsProvider ? this.resourceStatsProvider() : null
        };
    }

    /**
     * Get performance metrics for specific tool
     */
    getToolMetrics(toolName: string): Partial<PerformanceMetrics> {
        const toolRecords = this.callRecords.filter(r => r.toolName === toolName);

        if (toolRecords.length === 0) {
            return {
                toolCallCount: 0,
                averageCallTime: 0,
                maxCallTime: 0,
                minCallTime: 0,
                successfulCalls: 0,
                failedCalls: 0,
                successRate: 0,
                throughput: 0
            };
        }

        const successfulCalls = toolRecords.filter(r => r.success).length;
        const failedCalls = toolRecords.length - successfulCalls;
        const durations = toolRecords.map(r => r.duration);

        return {
            toolCallCount: toolRecords.length,
            averageCallTime: durations.reduce((sum, d) => sum + d, 0) / durations.length,
            maxCallTime: Math.max(...durations),
            minCallTime: Math.min(...durations),
            successfulCalls,
            failedCalls,
            successRate: successfulCalls / toolRecords.length,
            throughput: toolRecords.filter(r =>
                performance.now() - r.endTime < 60000
            ).length / 60
        };
    }

    /**
     * Reset performance metrics
     */
    reset(): void {
        this.callRecords = [];
        this.memorySnapshots = [];
    }

    /**
     * Generate performance report
     */
    generateReport(): string {
        const metrics = this.getMetrics();

        return `
=== Tool Performance Report ===
Total Calls: ${metrics.toolCallCount}
Success Rate: ${(metrics.successRate * 100).toFixed(2)}%
Average Response Time: ${metrics.averageCallTime.toFixed(2)}ms
Max Response Time: ${metrics.maxCallTime.toFixed(2)}ms
Min Response Time: ${metrics.minCallTime.toFixed(2)}ms
Throughput: ${metrics.throughput.toFixed(2)} TPS

Memory Usage:
- Current Heap: ${(metrics.memoryUsage.currentHeapUsed / 1024 / 1024).toFixed(2)}MB
- Max Heap: ${(metrics.memoryUsage.maxHeapUsed / 1024 / 1024).toFixed(2)}MB
- Average Heap: ${(metrics.memoryUsage.averageHeapUsed / 1024 / 1024).toFixed(2)}MB

${metrics.cacheMetrics ? `
Cache Performance:
- Hit Rate: ${(metrics.cacheMetrics.hitRate * 100).toFixed(2)}%
- Cache Items: ${metrics.cacheMetrics.totalItems}
- Memory Usage: ${(metrics.cacheMetrics.estimatedMemoryUsage / 1024).toFixed(2)}KB
` : ''}

${metrics.resourceMetrics ? `
Resource Management:
- Total Resources: ${metrics.resourceMetrics.totalResources}
- Memory Usage: ${(metrics.resourceMetrics.estimatedMemoryUsage / 1024 / 1024).toFixed(2)}MB
` : ''}
`.trim();
    }

    /**
     * Collect memory snapshot
     */
    private collectMemorySnapshot(): void {
        const memUsage = process.memoryUsage();
        this.memorySnapshots.push(memUsage.heapUsed);

        // Limit snapshot count
        if (this.memorySnapshots.length > 1000) {
            this.memorySnapshots.splice(0, 100); // remove 100 oldest
        }
    }

    /**
     * Calculate memory metrics
     */
    private calculateMemoryMetrics(): MemoryUsageMetrics {
        const memUsage = process.memoryUsage();

        return {
            currentHeapUsed: memUsage.heapUsed,
            maxHeapUsed: this.memorySnapshots.length > 0 ? Math.max(...this.memorySnapshots) : memUsage.heapUsed,
            averageHeapUsed: this.memorySnapshots.length > 0
                ? this.memorySnapshots.reduce((sum, snap) => sum + snap, 0) / this.memorySnapshots.length
                : memUsage.heapUsed,
            external: memUsage.external,
            rss: memUsage.rss
        };
    }

    /**
     * Collect metrics and trigger events
     */
    private collectMetrics(): void {
        try {
            const metrics = this.getMetrics();

            // Notify event listeners
            for (const listener of this.eventListeners) {
                try {
                    listener(metrics);
                } catch (error) {
                    console.error('Performance event listener error:', error);
                }
            }
        } catch (error) {
            console.error('Failed to collect performance metrics:', error);
        }
    }

    /**
     * Estimate object size
     */
    private estimateObjectSize(obj: any): number {
        if (obj === null || obj === undefined) {
            return 8;
        }

        switch (typeof obj) {
            case 'string':
                return obj.length * 2;
            case 'number':
                return 8;
            case 'boolean':
                return 4;
            case 'object':
                if (Array.isArray(obj)) {
                    return obj.reduce((acc, item) => acc + this.estimateObjectSize(item), 0);
                } else {
                    let size = 0;
                    for (const key in obj) {
                        size += key.length * 2;
                        size += this.estimateObjectSize(obj[key]);
                    }
                    return size;
                }
            default:
                return 16;
        }
    }
}

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor({
    maxRecords: 10000,
    monitoringIntervalMs: 5000
}); 