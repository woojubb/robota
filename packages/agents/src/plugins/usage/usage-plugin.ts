import { BasePlugin, PluginCategory, PluginPriority } from '../../abstracts/base-plugin';
import { Logger, createLogger } from '../../utils/logger';
import { PluginError, ConfigurationError } from '../../utils/errors';
import type { EventType, EventData } from '../event-emitter-plugin';
import {
    UsageStats,
    AggregatedUsageStats,
    UsagePluginOptions,
    UsagePluginStats,
    UsageStorage
} from './types';
import {
    MemoryUsageStorage,
    FileUsageStorage,
    RemoteUsageStorage,
    SilentUsageStorage
} from './storages/index';

/**
 * Plugin for tracking usage statistics
 * Collects and stores usage data including tokens, costs, performance metrics
 */
export class UsagePlugin extends BasePlugin<UsagePluginOptions, UsagePluginStats> {
    name = 'UsagePlugin';
    version = '1.0.0';

    private storage: UsageStorage;
    private pluginOptions: Required<Omit<UsagePluginOptions, 'costRates'>> & { costRates?: Record<string, { input: number; output: number }> };
    private logger: Logger;
    private aggregationTimer?: NodeJS.Timeout;

    constructor(options: UsagePluginOptions) {
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
            maxEntries: options.maxEntries ?? 10000,
            trackCosts: options.trackCosts ?? true,
            ...(options.costRates && { costRates: options.costRates }),
            batchSize: options.batchSize ?? 50,
            flushInterval: options.flushInterval ?? 60000, // 1 minute
            aggregateStats: options.aggregateStats ?? true,
            aggregationInterval: options.aggregationInterval ?? 300000, // 5 minutes
            // Add BasePluginOptions defaults
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
     * Handle module events for usage tracking
     */
    override async onModuleEvent(eventType: EventType, eventData: EventData): Promise<void> {
        try {
            // Extract module event data from eventData.data
            const moduleData = eventData.data as any;

            switch (eventType) {
                case 'module.initialize.complete':
                case 'module.execution.complete':
                case 'module.dispose.complete':
                    // Track module usage statistics
                    if (moduleData?.duration) {
                        await this.recordUsage({
                            provider: 'module',
                            model: moduleData?.moduleType || 'unknown',
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
                                moduleName: moduleData?.moduleName || 'unknown',
                                moduleType: moduleData?.moduleType || 'unknown',
                                operation: eventType.includes('initialize') ? 'initialization' :
                                    eventType.includes('execution') ? 'execution' : 'disposal'
                            }
                        });
                    }
                    break;

                case 'module.initialize.error':
                case 'module.execution.error':
                case 'module.dispose.error':
                    // Track module error statistics
                    if (moduleData?.duration) {
                        await this.recordUsage({
                            provider: 'module',
                            model: moduleData?.moduleType || 'unknown',
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
                                moduleName: moduleData?.moduleName || 'unknown',
                                moduleType: moduleData?.moduleType || 'unknown',
                                operation: eventType.includes('initialize') ? 'initialization' :
                                    eventType.includes('execution') ? 'execution' : 'disposal',
                                error: eventData.error?.message || 'unknown error'
                            }
                        });
                    }
                    break;
            }
        } catch (error) {
            // Log the error but don't throw to avoid breaking module event processing
            console.error(`UsagePlugin failed to handle module event ${eventType}:`, error);
        }
    }

    /**
     * Record usage statistics
     */
    async recordUsage(usage: Omit<UsageStats, 'timestamp' | 'cost'>): Promise<void> {
        try {
            const cost = this.pluginOptions.trackCosts ? this.calculateCost(usage.model, usage.tokensUsed) : undefined;

            const entry: UsageStats = {
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
     * Get usage statistics
     */
    async getUsageStats(conversationId?: string, timeRange?: { start: Date; end: Date }): Promise<UsageStats[]> {
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
     * Get aggregated usage statistics
     */
    async getAggregatedStats(timeRange?: { start: Date; end: Date }): Promise<AggregatedUsageStats> {
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
     * Cleanup resources
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
    private validateOptions(options: UsagePluginOptions): void {
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
    private createStorage(): UsageStorage {
        switch (this.pluginOptions.strategy) {
            case 'memory':
                return new MemoryUsageStorage(this.pluginOptions.maxEntries);
            case 'file':
                return new FileUsageStorage(this.pluginOptions.filePath);
            case 'remote':
                return new RemoteUsageStorage(
                    this.pluginOptions.remoteEndpoint!,
                    '',  // apiKey - not in options
                    30000,  // timeout - not in options
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
        this.aggregationTimer = setInterval(async () => {
            try {
                const stats = await this.getAggregatedStats();
                this.logger.debug('Periodic usage aggregation', {
                    totalRequests: stats.totalRequests,
                    totalTokens: stats.totalTokens,
                    totalCost: stats.totalCost,
                    successRate: stats.successRate
                });
            } catch (error) {
                this.logger.error('Error during periodic aggregation', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.pluginOptions.aggregationInterval);
    }
} 