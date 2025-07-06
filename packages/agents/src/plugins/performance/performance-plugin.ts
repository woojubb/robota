import { BasePlugin, PluginCategory, PluginPriority } from '../../abstracts/base-plugin';
import { Logger, createLogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import type { EventType, EventData } from '../event-emitter-plugin';
import {
    PerformanceMetrics,
    AggregatedPerformanceStats,
    PerformancePluginOptions,
    PerformancePluginStats,
    PerformanceStorage,
    SystemMetricsCollector
} from './types';
import { MemoryPerformanceStorage } from './storages/index';
import { NodeSystemMetricsCollector } from './collectors/system-metrics-collector';

/**
 * Plugin for monitoring performance metrics
 * Collects system and application performance data
 */
export class PerformancePlugin extends BasePlugin<PerformancePluginOptions, PerformancePluginStats> {
    name = 'PerformancePlugin';
    version = '1.0.0';

    private storage: PerformanceStorage;
    private metricsCollector: SystemMetricsCollector;
    private pluginOptions: Required<PerformancePluginOptions>;
    private logger: Logger;

    constructor(options: PerformancePluginOptions) {
        super();
        this.logger = createLogger('PerformancePlugin');

        // Set plugin classification
        this.category = PluginCategory.MONITORING;
        this.priority = PluginPriority.NORMAL;

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.pluginOptions = {
            enabled: options.enabled ?? true,
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
            // Add BasePluginOptions defaults
            category: options.category ?? PluginCategory.MONITORING,
            priority: options.priority ?? PluginPriority.NORMAL,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
        };

        // Initialize storage and metrics collector
        this.storage = this.createStorage();
        this.metricsCollector = new NodeSystemMetricsCollector();

        this.logger.info('PerformancePlugin initialized', {
            strategy: this.pluginOptions.strategy,
            monitorMemory: this.pluginOptions.monitorMemory,
            monitorCPU: this.pluginOptions.monitorCPU,
            performanceThreshold: this.pluginOptions.performanceThreshold
        });
    }

    /**
     * Handle module events for performance monitoring
     */
    override async onModuleEvent(eventType: EventType, eventData: EventData): Promise<void> {
        try {
            // Extract module event data from eventData.data
            const moduleData = eventData.data;

            switch (eventType) {
                case 'module.initialize.start':
                    // Start tracking module initialization performance
                    break;

                case 'module.initialize.complete':
                    if (moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number') {
                        await this.recordMetrics({
                            operation: 'module_initialization',
                            duration: moduleData['duration'],
                            success: true,
                            errorCount: 0,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                phase: 'initialization'
                            }
                        });
                    }
                    break;

                case 'module.initialize.error':
                    if (moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number') {
                        await this.recordMetrics({
                            operation: 'module_initialization',
                            duration: moduleData['duration'],
                            success: false,
                            errorCount: 1,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                phase: 'initialization',
                                error: eventData.error?.message || 'unknown error'
                            }
                        });
                    }
                    break;

                case 'module.execution.complete':
                    if (moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number') {
                        await this.recordMetrics({
                            operation: 'module_execution',
                            duration: moduleData['duration'],
                            success: ('success' in moduleData && typeof moduleData['success'] === 'boolean') ? moduleData['success'] : true,
                            errorCount: ('success' in moduleData && moduleData['success'] === false) ? 1 : 0,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                phase: 'execution'
                            }
                        });
                    }
                    break;

                case 'module.execution.error':
                    if (moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number') {
                        await this.recordMetrics({
                            operation: 'module_execution',
                            duration: moduleData['duration'],
                            success: false,
                            errorCount: 1,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                phase: 'execution',
                                error: eventData.error?.message || 'unknown error'
                            }
                        });
                    }
                    break;

                case 'module.dispose.complete':
                    if (moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number') {
                        await this.recordMetrics({
                            operation: 'module_disposal',
                            duration: moduleData['duration'],
                            success: true,
                            errorCount: 0,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                phase: 'disposal'
                            }
                        });
                    }
                    break;

                case 'module.dispose.error':
                    if (moduleData && 'duration' in moduleData && typeof moduleData['duration'] === 'number') {
                        await this.recordMetrics({
                            operation: 'module_disposal',
                            duration: moduleData['duration'],
                            success: false,
                            errorCount: 1,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                phase: 'disposal',
                                error: eventData.error?.message || 'unknown error'
                            }
                        });
                    }
                    break;
            }
        } catch (error) {
            // Log the error but don't throw to avoid breaking module event processing
            // PerformancePlugin failed to handle module event
        }
    }

    /**
     * Record performance metrics
     */
    async recordMetrics(metrics: Omit<PerformanceMetrics, 'timestamp' | 'memoryUsage' | 'cpuUsage' | 'networkStats'>): Promise<void> {
        try {
            const memoryUsage = this.pluginOptions.monitorMemory ? await this.metricsCollector.getMemoryUsage() : undefined;
            const cpuUsage = this.pluginOptions.monitorCPU ? await this.metricsCollector.getCPUUsage() : undefined;
            const networkStats = this.pluginOptions.monitorNetwork ? await this.metricsCollector.getNetworkStats() : undefined;

            const entry: PerformanceMetrics = {
                ...metrics,
                timestamp: new Date(),
                ...(memoryUsage && { memoryUsage }),
                ...(cpuUsage && { cpuUsage }),
                ...(networkStats && { networkStats })
            };

            await this.storage.save(entry);

            // Log warning if performance threshold exceeded
            if (entry.duration > this.pluginOptions.performanceThreshold) {
                this.logger.warn('Performance threshold exceeded', {
                    operation: entry.operation,
                    duration: entry.duration,
                    threshold: this.pluginOptions.performanceThreshold,
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
                operation: operation || 'all',
                timeRange: timeRange ? `${timeRange.start.toISOString()}-${timeRange.end.toISOString()}` : 'all',
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
                timeRange: timeRange ? `${timeRange.start.toISOString()}-${timeRange.end.toISOString()}` : 'all',
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
            this.logger.error('Error during plugin cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
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
        switch (this.pluginOptions.strategy) {
            case 'memory':
                return new MemoryPerformanceStorage(this.pluginOptions.maxEntries);
            default:
                // For now, fallback to memory storage for other strategies
                this.logger.warn(`Strategy '${this.pluginOptions.strategy}' not fully implemented, using memory storage`);
                return new MemoryPerformanceStorage(this.pluginOptions.maxEntries);
        }
    }
} 