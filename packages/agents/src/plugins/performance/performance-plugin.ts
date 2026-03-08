import { AbstractPlugin, PluginCategory, PluginPriority } from '../../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import type { IEventEmitterEventData, TEventName } from '../event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../event-emitter/types';
import {
    IPerformanceMetrics,
    IAggregatedPerformanceStats,
    IPerformancePluginOptions,
    IPerformancePluginStats,
    IPerformanceStorage,
    ISystemMetricsCollector
} from './types';
import { MemoryPerformanceStorage } from './storages/index';
import { NodeSystemMetricsCollector } from './collectors/system-metrics-collector';

/**
 * Collects application and system performance metrics during agent execution.
 *
 * Optionally monitors memory, CPU, and network via
 * {@link ISystemMetricsCollector}. Logs a warning when an operation exceeds
 * the configured {@link IPerformancePluginOptions.performanceThreshold | performanceThreshold}.
 * Currently only the `memory` storage strategy is implemented.
 *
 * Lifecycle hooks used: {@link AbstractPlugin.onModuleEvent | onModuleEvent}
 *
 * @extends AbstractPlugin
 * @see IPerformanceStorage - storage backend contract
 * @see ISystemMetricsCollector - system metrics collection contract
 * @see IPerformancePluginOptions - configuration options
 *
 * @example
 * ```ts
 * const plugin = new PerformancePlugin({
 *   strategy: 'memory',
 *   monitorMemory: true,
 *   performanceThreshold: 2000,
 * });
 * await plugin.recordMetrics({ operation: 'run', duration: 1500, success: true, errorCount: 0 });
 * ```
 */
export class PerformancePlugin extends AbstractPlugin<IPerformancePluginOptions, IPerformancePluginStats> {
    name = 'PerformancePlugin';
    version = '1.0.0';

    private storage: IPerformanceStorage;
    private metricsCollector: ISystemMetricsCollector;
    private pluginOptions: Required<IPerformancePluginOptions>;
    private logger: ILogger;

    constructor(options: IPerformancePluginOptions) {
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
            // Add plugin options defaults
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
     * Records performance metrics from module lifecycle events
     * (initialization, execution, disposal) including duration and error counts.
     */
    override async onModuleEvent(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> {
        try {
            // Extract module event data from eventData.data
            const moduleData = eventData.data;

            switch (eventName) {
                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START:
                    // Start tracking module initialization performance
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE:
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

                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR:
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

                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE:
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

                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR:
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

                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE:
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

                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR:
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
     * Records performance metrics, enriching them with system metrics (memory,
     * CPU, network) when the corresponding monitoring options are enabled.
     * @throws PluginError if the storage write fails
     */
    async recordMetrics(metrics: Omit<IPerformanceMetrics, 'timestamp' | 'memoryUsage' | 'cpuUsage' | 'networkStats'>): Promise<void> {
        try {
            const memoryUsage = this.pluginOptions.monitorMemory ? await this.metricsCollector.getMemoryUsage() : undefined;
            const cpuUsage = this.pluginOptions.monitorCPU ? await this.metricsCollector.getCPUUsage() : undefined;
            const networkStats = this.pluginOptions.monitorNetwork ? await this.metricsCollector.getNetworkStats() : undefined;

            const entry: IPerformanceMetrics = {
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
     * Retrieves recorded metrics, optionally filtered by operation name and time range.
     * @throws PluginError if the storage read fails
     */
    async getMetrics(operation?: string, timeRange?: { start: Date; end: Date }): Promise<IPerformanceMetrics[]> {
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
    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<IAggregatedPerformanceStats> {
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
     * Closes the underlying storage and releases resources.
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

    private validateOptions(options: IPerformancePluginOptions): void {
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

    private createStorage(): IPerformanceStorage {
        switch (this.pluginOptions.strategy) {
            case 'memory':
                return new MemoryPerformanceStorage(this.pluginOptions.maxEntries);
            default:
                throw new ConfigurationError('Performance monitoring strategy is not implemented', {
                    provided: this.pluginOptions.strategy
                });
        }
    }
} 