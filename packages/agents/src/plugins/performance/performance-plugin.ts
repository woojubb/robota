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

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 30000;
const DEFAULT_AGGREGATION_INTERVAL_MS = 60000;
const DEFAULT_PERFORMANCE_THRESHOLD_MS = 1000;

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
            maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
            monitorMemory: options.monitorMemory ?? true,
            monitorCPU: options.monitorCPU ?? true,
            monitorNetwork: options.monitorNetwork ?? false,
            batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
            flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS,
            aggregateStats: options.aggregateStats ?? true,
            aggregationInterval: options.aggregationInterval ?? DEFAULT_AGGREGATION_INTERVAL_MS,
            performanceThreshold: options.performanceThreshold ?? DEFAULT_PERFORMANCE_THRESHOLD_MS,
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

    /** Event name → metrics descriptor mapping. */
    private static readonly MODULE_EVENT_MAP: ReadonlyMap<string, { operation: string; phase: string; isError: boolean }> = new Map([
        [EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE, { operation: 'module_initialization', phase: 'initialization', isError: false }],
        [EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR, { operation: 'module_initialization', phase: 'initialization', isError: true }],
        [EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE, { operation: 'module_execution', phase: 'execution', isError: false }],
        [EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR, { operation: 'module_execution', phase: 'execution', isError: true }],
        [EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE, { operation: 'module_disposal', phase: 'disposal', isError: false }],
        [EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR, { operation: 'module_disposal', phase: 'disposal', isError: true }],
    ]);

    /**
     * Records performance metrics from module lifecycle events
     * (initialization, execution, disposal) including duration and error counts.
     */
    override async onModuleEvent(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> {
        try {
            const descriptor = PerformancePlugin.MODULE_EVENT_MAP.get(eventName);
            if (!descriptor) return;

            const { moduleName, moduleType, duration, success } = PerformancePlugin.extractModuleData(eventData.data);
            if (duration === undefined) return;

            await this.recordMetrics({
                operation: descriptor.operation,
                duration,
                success: descriptor.isError ? false : (success ?? true),
                errorCount: descriptor.isError ? 1 : 0,
                ...(eventData.executionId && { executionId: eventData.executionId }),
                metadata: {
                    moduleName,
                    moduleType,
                    phase: descriptor.phase,
                    ...(descriptor.isError && { error: eventData.error?.message || 'unknown error' }),
                },
            });
        } catch (_error) {
            // Swallow to avoid breaking module event processing
        }
    }

    /** Safely extracts module data fields from untyped event data. */
    private static extractModuleData(data: unknown): {
        moduleName: string;
        moduleType: string;
        duration?: number;
        success?: boolean;
    } {
        const record = (typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {};
        return {
            moduleName: typeof record['moduleName'] === 'string' ? record['moduleName'] : 'unknown',
            moduleType: typeof record['moduleType'] === 'string' ? record['moduleType'] : 'unknown',
            ...(typeof record['duration'] === 'number' && { duration: record['duration'] }),
            ...(typeof record['success'] === 'boolean' && { success: record['success'] }),
        };
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