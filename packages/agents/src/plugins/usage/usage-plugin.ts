import { AbstractPlugin, PluginCategory, PluginPriority } from '../../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import type { IEventEmitterEventData, TEventName } from '../event-emitter-plugin';
import type { TTimerId } from '../../utils/index';
import { EVENT_EMITTER_EVENTS } from '../event-emitter/types';
import { startPeriodicTask } from '../../utils/periodic-task';
import {
    IUsageStats,
    IAggregatedUsageStats,
    IUsagePluginOptions,
    IUsagePluginStats,
    IUsageStorage
} from './types';
import {
    MemoryUsageStorage,
    FileUsageStorage,
    RemoteUsageStorage,
    SilentUsageStorage
} from './storages/index';

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 60000;
const DEFAULT_AGGREGATION_INTERVAL_MS = 300000;
const DEFAULT_REMOTE_TIMEOUT_MS = 30000;

/**
 * Tracks token usage, request counts, and costs across agent executions.
 *
 * Supports memory, file, remote, and silent storage strategies. When
 * {@link IUsagePluginOptions.trackCosts | trackCosts} is enabled, per-model
 * cost rates are applied automatically. Periodic aggregation can be enabled
 * via {@link IUsagePluginOptions.aggregateStats | aggregateStats}.
 *
 * Lifecycle hooks used: {@link AbstractPlugin.onModuleEvent | onModuleEvent}
 *
 * @extends AbstractPlugin
 * @see IUsageStorage - storage backend contract
 * @see IUsagePluginOptions - configuration options
 *
 * @example
 * ```ts
 * const plugin = new UsagePlugin({
 *   strategy: 'memory',
 *   trackCosts: true,
 *   costRates: { 'gpt-4': { input: 0.03, output: 0.06 } },
 * });
 * await plugin.recordUsage({ provider: 'openai', model: 'gpt-4', ... });
 * ```
 */
export class UsagePlugin extends AbstractPlugin<IUsagePluginOptions, IUsagePluginStats> {
    name = 'UsagePlugin';
    version = '1.0.0';

    private storage: IUsageStorage;
    private pluginOptions: Required<Omit<IUsagePluginOptions, 'costRates'>> & { costRates?: Record<string, { input: number; output: number }> };
    private logger: ILogger;
    private aggregationTimer?: TTimerId;

    constructor(options: IUsagePluginOptions) {
        super();
        this.logger = createLogger('UsagePlugin');

        // Set plugin classification
        this.category = PluginCategory.MONITORING;
        this.priority = PluginPriority.NORMAL;

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            strategy: options.strategy,
            filePath: options.filePath ?? './usage-stats.json',
            remoteEndpoint: options.remoteEndpoint ?? '',
            remoteHeaders: options.remoteHeaders ?? {},
            maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
            trackCosts: options.trackCosts ?? true,
            ...(options.costRates && { costRates: options.costRates }),
            batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
            flushInterval: options.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS,
            aggregateStats: options.aggregateStats ?? true,
            aggregationInterval: options.aggregationInterval ?? DEFAULT_AGGREGATION_INTERVAL_MS,
            // Add plugin options defaults
            category: options.category ?? PluginCategory.MONITORING,
            priority: options.priority ?? PluginPriority.NORMAL,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
        };

        // Initialize storage
        this.storage = this.createStorage();

        // Setup aggregation if enabled
        if (this.pluginOptions.aggregateStats) {
            this.setupAggregation();
        }

        this.logger.info('UsagePlugin initialized', {
            strategy: this.pluginOptions.strategy,
            trackCosts: this.pluginOptions.trackCosts,
            maxEntries: this.pluginOptions.maxEntries
        });
    }

    /**
     * Records usage statistics from module lifecycle events (completion and
     * error events). Duration-bearing events are recorded with zero token
     * counts as module events do not involve LLM calls.
     */
    override async onModuleEvent(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> {
        try {
            // Extract module event data from eventData.data
            const moduleData = eventData.data;

            switch (eventName) {
                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE:
                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE:
                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE:
                    // Track module usage statistics
                    if (moduleData && 'duration' in moduleData && typeof moduleData.duration === 'number') {
                        await this.recordUsage({
                            provider: 'module',
                            model: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                            tokensUsed: {
                                input: 0,
                                output: 0,
                                total: 0
                            },
                            requestCount: 1,
                            duration: moduleData.duration,
                            success: true,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            ...(eventData.sessionId && { conversationId: eventData.sessionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                operation: eventName.includes('initialize') ? 'initialization' :
                                    eventName.includes('execution') ? 'execution' : 'disposal'
                            }
                        });
                    }
                    break;

                case EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR:
                case EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR:
                case EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR:
                    // Track module error statistics
                    if (moduleData && 'duration' in moduleData && typeof moduleData.duration === 'number') {
                        await this.recordUsage({
                            provider: 'module',
                            model: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                            tokensUsed: {
                                input: 0,
                                output: 0,
                                total: 0
                            },
                            requestCount: 1,
                            duration: moduleData.duration,
                            success: false,
                            ...(eventData.executionId && { executionId: eventData.executionId }),
                            ...(eventData.sessionId && { conversationId: eventData.sessionId }),
                            metadata: {
                                moduleName: ('moduleName' in moduleData && typeof moduleData['moduleName'] === 'string') ? moduleData['moduleName'] : 'unknown',
                                moduleType: ('moduleType' in moduleData && typeof moduleData['moduleType'] === 'string') ? moduleData['moduleType'] : 'unknown',
                                operation: eventName.includes('initialize') ? 'initialization' :
                                    eventName.includes('execution') ? 'execution' : 'disposal',
                                error: eventData.error?.message || 'unknown error'
                            }
                        });
                    }
                    break;
            }
        } catch (error) {
            // Log the error but don't throw to avoid breaking module event processing
            // UsagePlugin failed to handle module event
        }
    }

    /**
     * Records a usage entry, calculating cost if cost tracking is enabled and
     * a rate is configured for the model.
     * @throws PluginError if the storage write fails
     */
    async recordUsage(usage: Omit<IUsageStats, 'timestamp' | 'cost'>): Promise<void> {
        try {
            const cost = this.pluginOptions.trackCosts ? this.calculateCost(usage.model, usage.tokensUsed) : undefined;

            const entry: IUsageStats = {
                ...usage,
                timestamp: new Date(),
                ...(cost && { cost })
            };

            await this.storage.save(entry);

            this.logger.debug('Usage recorded', {
                provider: entry.provider,
                model: entry.model,
                tokens: entry.tokensUsed.total,
                cost: entry.cost?.total,
                success: entry.success
            });
        } catch (error) {
            throw new PluginError('Failed to record usage', this.name, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Retrieves usage entries, optionally filtered by conversation and time range.
     * @throws PluginError if the storage read fails
     */
    async getUsageStats(conversationId?: string, timeRange?: { start: Date; end: Date }): Promise<IUsageStats[]> {
        try {
            return await this.storage.getStats(conversationId, timeRange);
        } catch (error) {
            throw new PluginError('Failed to get usage stats', this.name, {
                conversationId: conversationId || 'all',
                timeRange: timeRange ? `${timeRange.start.toISOString()}-${timeRange.end.toISOString()}` : 'all',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Returns aggregated totals (requests, tokens, cost, success rate) across
     * all recorded usage entries within the optional time range.
     * @throws PluginError if the storage aggregation fails
     */
    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<IAggregatedUsageStats> {
        try {
            return await this.storage.getAggregatedStats(timeRange);
        } catch (error) {
            throw new PluginError('Failed to get aggregated usage stats', this.name, {
                timeRange: timeRange ? `${timeRange.start.toISOString()}-${timeRange.end.toISOString()}` : 'all',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Clear all usage statistics
     */
    async clearStats(): Promise<void> {
        try {
            await this.storage.clear();
            this.logger.info('Usage statistics cleared');
        } catch (error) {
            throw new PluginError('Failed to clear usage stats', this.name, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Flush pending statistics
     */
    async flush(): Promise<void> {
        try {
            await this.storage.flush();
        } catch (error) {
            throw new PluginError('Failed to flush usage stats', this.name, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Stops the aggregation timer and closes the underlying storage.
     */
    async destroy(): Promise<void> {
        try {
            if (this.aggregationTimer) {
                clearInterval(this.aggregationTimer);
            }

            await this.storage.close();
            this.logger.info('UsagePlugin destroyed');
        } catch (error) {
            this.logger.error('Error during plugin cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Calculate cost based on token usage and model rates
     */
    private calculateCost(model: string, tokens: { input: number; output: number; total: number }): { input: number; output: number; total: number } | undefined {
        if (!this.pluginOptions.costRates || !this.pluginOptions.costRates[model]) {
            return undefined;
        }

        const rates = this.pluginOptions.costRates[model];
        const inputCost = tokens.input * rates.input;
        const outputCost = tokens.output * rates.output;

        return {
            input: inputCost,
            output: outputCost,
            total: inputCost + outputCost
        };
    }

    /**
     * Validate plugin options
     */
    private validateOptions(options: IUsagePluginOptions): void {
        if (!options.strategy) {
            throw new ConfigurationError('Usage tracking strategy is required');
        }

        if (!['memory', 'file', 'remote', 'silent'].includes(options.strategy)) {
            throw new ConfigurationError('Invalid usage tracking strategy', {
                validStrategies: ['memory', 'file', 'remote', 'silent'],
                provided: options.strategy
            });
        }

        if (options.strategy === 'file' && !options.filePath) {
            throw new ConfigurationError('File path is required for file usage tracking strategy');
        }

        if (options.strategy === 'remote' && !options.remoteEndpoint) {
            throw new ConfigurationError('Remote endpoint is required for remote usage tracking strategy');
        }

        if (options.maxEntries !== undefined && options.maxEntries <= 0) {
            throw new ConfigurationError('Max entries must be positive');
        }

        if (options.batchSize !== undefined && options.batchSize <= 0) {
            throw new ConfigurationError('Batch size must be positive');
        }

        if (options.flushInterval !== undefined && options.flushInterval <= 0) {
            throw new ConfigurationError('Flush interval must be positive');
        }

        if (options.aggregationInterval !== undefined && options.aggregationInterval <= 0) {
            throw new ConfigurationError('Aggregation interval must be positive');
        }
    }

    /**
     * Create storage instance based on strategy
     */
    private createStorage(): IUsageStorage {
        switch (this.pluginOptions.strategy) {
            case 'memory':
                return new MemoryUsageStorage(this.pluginOptions.maxEntries);
            case 'file':
                return new FileUsageStorage(this.pluginOptions.filePath);
            case 'remote':
                return new RemoteUsageStorage(
                    this.pluginOptions.remoteEndpoint!,
                    '',  // apiKey - not in options
                    DEFAULT_REMOTE_TIMEOUT_MS,
                    this.pluginOptions.remoteHeaders || {},
                    this.pluginOptions.batchSize,
                    this.pluginOptions.flushInterval
                );
            case 'silent':
                return new SilentUsageStorage();
            default:
                throw new ConfigurationError('Unknown usage tracking strategy', { strategy: this.pluginOptions.strategy });
        }
    }

    /**
     * Setup periodic aggregation
     */
    private setupAggregation(): void {
        this.aggregationTimer = startPeriodicTask(
            this.logger,
            { name: 'UsagePlugin.aggregate', intervalMs: this.pluginOptions.aggregationInterval },
            async () => {
                const stats = await this.getAggregatedStats();
                this.logger.debug('Periodic usage aggregation', {
                    totalRequests: stats.totalRequests,
                    totalTokens: stats.totalTokens,
                    totalCost: stats.totalCost,
                    successRate: stats.successRate
                });
            }
        );
    }
} 