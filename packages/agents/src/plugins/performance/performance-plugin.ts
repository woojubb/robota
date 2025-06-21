import { BasePlugin } from '../../abstracts/base-plugin.js';
import { Logger } from '../../utils/logger.js';
import { PluginError, ConfigurationError } from '../../utils/errors.js';
import {
    PerformanceMonitoringStrategy,
    PerformanceMetrics,
    AggregatedPerformanceStats,
    PerformancePluginOptions,
    PerformanceStorage,
    SystemMetricsCollector
} from './types.js';
import { MemoryPerformanceStorage } from './storages/index.js';
import { NodeSystemMetricsCollector } from './collectors/system-metrics-collector.js';

/**
 * Plugin for monitoring performance metrics
 * Collects system and application performance data
 */
export class PerformancePlugin extends BasePlugin {
    name = 'PerformancePlugin';
    version = '1.0.0';

    private storage: PerformanceStorage;
    private metricsCollector: SystemMetricsCollector;
    private options: Required<PerformancePluginOptions>;
    private logger: Logger;

    constructor(options: PerformancePluginOptions) {
        super();
        this.logger = new Logger('PerformancePlugin');

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.options = {
            strategy: options.strategy,
            filePath: options.filePath ?? './performance-metrics.json',
            remoteEndpoint: options.remoteEndpoint ?? '',
            prometheusEndpoint: options.prometheusEndpoint ?? '/metrics',
            remoteHeaders: options.remoteHeaders ?? {},
            maxEntries: options.maxEntries ?? 5000,
            monitorMemory: options.monitorMemory ?? true,
            monitorCPU: options.monitorCPU ?? true,
            monitorNetwork: options.monitorNetwork ?? false,
            batchSize: options.batchSize ?? 100,
            flushInterval: options.flushInterval ?? 30000,
            aggregateStats: options.aggregateStats ?? true,
            aggregationInterval: options.aggregationInterval ?? 60000,
            performanceThreshold: options.performanceThreshold ?? 1000, // 1 second
        };

        // Initialize storage and metrics collector
        this.storage = this.createStorage();
        this.metricsCollector = new NodeSystemMetricsCollector();

        this.logger.info('PerformancePlugin initialized', {
            strategy: this.options.strategy,
            monitorMemory: this.options.monitorMemory,
            monitorCPU: this.options.monitorCPU,
            performanceThreshold: this.options.performanceThreshold
        });
    }

    /**
     * Record performance metrics
     */
    async recordMetrics(metrics: Omit<PerformanceMetrics, 'timestamp' | 'memoryUsage' | 'cpuUsage' | 'networkStats'>): Promise<void> {
        try {
            const entry: PerformanceMetrics = {
                ...metrics,
                timestamp: new Date(),
                memoryUsage: this.options.monitorMemory ? await this.metricsCollector.getMemoryUsage() : undefined,
                cpuUsage: this.options.monitorCPU ? await this.metricsCollector.getCPUUsage() : undefined,
                networkStats: this.options.monitorNetwork ? await this.metricsCollector.getNetworkStats() : undefined
            };

            await this.storage.save(entry);

            // Log warning if performance threshold exceeded
            if (entry.duration > this.options.performanceThreshold) {
                this.logger.warn('Performance threshold exceeded', {
                    operation: entry.operation,
                    duration: entry.duration,
                    threshold: this.options.performanceThreshold,
                    executionId: entry.executionId
                });
            }

            this.logger.debug('Performance metrics recorded', {
                operation: entry.operation,
                duration: entry.duration,
                success: entry.success,
                memoryUsed: entry.memoryUsage?.heap.used
            });
        } catch (error) {
            throw new PluginError('Failed to record performance metrics', this.name, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get performance metrics
     */
    async getMetrics(operation?: string, timeRange?: { start: Date; end: Date }): Promise<PerformanceMetrics[]> {
        try {
            return await this.storage.getMetrics(operation, timeRange);
        } catch (error) {
            throw new PluginError('Failed to get performance metrics', this.name, {
                operation,
                timeRange,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get aggregated performance statistics
     */
    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedPerformanceStats> {
        try {
            return await this.storage.getAggregatedStats(timeRange);
        } catch (error) {
            throw new PluginError('Failed to get aggregated performance stats', this.name, {
                timeRange,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Clear all performance metrics
     */
    async clearMetrics(): Promise<void> {
        try {
            await this.storage.clear();
            this.logger.info('Performance metrics cleared');
        } catch (error) {
            throw new PluginError('Failed to clear performance metrics', this.name, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        try {
            await this.storage.close();
            this.logger.info('PerformancePlugin destroyed');
        } catch (error) {
            this.logger.error('Error during plugin cleanup', { error });
        }
    }

    private validateOptions(options: PerformancePluginOptions): void {
        if (!options.strategy) {
            throw new ConfigurationError('Performance monitoring strategy is required');
        }

        if (!['memory', 'file', 'prometheus', 'remote', 'silent'].includes(options.strategy)) {
            throw new ConfigurationError('Invalid performance monitoring strategy', {
                validStrategies: ['memory', 'file', 'prometheus', 'remote', 'silent'],
                provided: options.strategy
            });
        }
    }

    private createStorage(): PerformanceStorage {
        switch (this.options.strategy) {
            case 'memory':
                return new MemoryPerformanceStorage(this.options.maxEntries);
            default:
                // For now, fallback to memory storage for other strategies
                this.logger.warn(`Strategy '${this.options.strategy}' not fully implemented, using memory storage`);
                return new MemoryPerformanceStorage(this.options.maxEntries);
        }
    }
} 