import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  createLogger,
  type ILogger,
  PluginError,
  ConfigurationError,
  type IEventEmitterEventData,
  type TEventName,
  type TTimerId,
  startPeriodicTask,
} from '@robota-sdk/agent-core';
import {
  IUsageStats,
  IAggregatedUsageStats,
  IUsagePluginOptions,
  IUsagePluginStats,
  IUsageStorage,
} from './types';
import {
  MemoryUsageStorage,
  FileUsageStorage,
  RemoteUsageStorage,
  SilentUsageStorage,
} from './storages/index';
import {
  type TResolvedUsageOptions,
  resolvePluginOptions,
  validateUsageOptions,
  calculateCost,
  isModuleSuccessEvent,
  isModuleErrorEvent,
  extractStringField,
  resolveOperation,
} from './usage-plugin-helpers';

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
  private pluginOptions: TResolvedUsageOptions;
  private logger: ILogger;
  private aggregationTimer?: TTimerId;

  constructor(options: IUsagePluginOptions) {
    super();
    this.logger = createLogger('UsagePlugin');
    this.category = PluginCategory.MONITORING;
    this.priority = PluginPriority.NORMAL;

    validateUsageOptions(options);
    this.pluginOptions = resolvePluginOptions(options);
    this.storage = this.createStorage();

    if (this.pluginOptions.aggregateStats) {
      this.setupAggregation();
    }

    this.logger.info('UsagePlugin initialized', {
      strategy: this.pluginOptions.strategy,
      trackCosts: this.pluginOptions.trackCosts,
      maxEntries: this.pluginOptions.maxEntries,
    });
  }

  /**
   * Records usage statistics from module lifecycle events (completion and
   * error events). Duration-bearing events are recorded with zero token
   * counts as module events do not involve LLM calls.
   */
  override async onModuleEvent(
    eventName: TEventName,
    eventData: IEventEmitterEventData,
  ): Promise<void> {
    try {
      const isSuccess = isModuleSuccessEvent(eventName);
      const isError = isModuleErrorEvent(eventName);
      if (!isSuccess && !isError) return;

      const moduleData = eventData.data;
      if (!moduleData || !('duration' in moduleData) || typeof moduleData.duration !== 'number')
        return;

      await this.recordModuleUsage(eventName, eventData, moduleData.duration, isSuccess);
    } catch {
      // Swallow to avoid breaking module event processing
    }
  }

  private async recordModuleUsage(
    eventName: TEventName,
    eventData: IEventEmitterEventData,
    duration: number,
    success: boolean,
  ): Promise<void> {
    const moduleData = eventData.data;
    const moduleName = extractStringField(moduleData, 'moduleName');
    const moduleType = extractStringField(moduleData, 'moduleType');
    const operation = resolveOperation(eventName);

    const metadata: Record<string, string> = { moduleName, moduleType, operation };
    if (!success) {
      metadata['error'] = eventData.error?.message || 'unknown error';
    }

    await this.recordUsage({
      provider: 'module',
      model: moduleType,
      tokensUsed: { input: 0, output: 0, total: 0 },
      requestCount: 1,
      duration,
      success,
      ...(eventData.executionId && { executionId: eventData.executionId }),
      ...(eventData.sessionId && { conversationId: eventData.sessionId }),
      metadata,
    });
  }

  /**
   * Records a usage entry, calculating cost if cost tracking is enabled and
   * a rate is configured for the model.
   * @throws PluginError if the storage write fails
   */
  async recordUsage(usage: Omit<IUsageStats, 'timestamp' | 'cost'>): Promise<void> {
    try {
      const cost = this.pluginOptions.trackCosts
        ? calculateCost(this.pluginOptions.costRates, usage.model, usage.tokensUsed)
        : undefined;

      const entry: IUsageStats = {
        ...usage,
        timestamp: new Date(),
        ...(cost && { cost }),
      };

      await this.storage.save(entry);

      this.logger.debug('Usage recorded', {
        provider: entry.provider,
        model: entry.model,
        tokens: entry.tokensUsed.total,
        cost: entry.cost?.total,
        success: entry.success,
      });
    } catch (error) {
      throw new PluginError('Failed to record usage', this.name, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Retrieves usage entries, optionally filtered by conversation and time range.
   * @throws PluginError if the storage read fails
   */
  async getUsageStats(
    conversationId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<IUsageStats[]> {
    try {
      return await this.storage.getStats(conversationId, timeRange);
    } catch (error) {
      throw new PluginError('Failed to get usage stats', this.name, {
        conversationId: conversationId || 'all',
        timeRange: timeRange
          ? `${timeRange.start.toISOString()}-${timeRange.end.toISOString()}`
          : 'all',
        error: error instanceof Error ? error.message : String(error),
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
        timeRange: timeRange
          ? `${timeRange.start.toISOString()}-${timeRange.end.toISOString()}`
          : 'all',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clearStats(): Promise<void> {
    try {
      await this.storage.clear();
      this.logger.info('Usage statistics cleared');
    } catch (error) {
      throw new PluginError('Failed to clear usage stats', this.name, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async flush(): Promise<void> {
    try {
      await this.storage.flush();
    } catch (error) {
      throw new PluginError('Failed to flush usage stats', this.name, {
        error: error instanceof Error ? error.message : String(error),
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
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private createStorage(): IUsageStorage {
    switch (this.pluginOptions.strategy) {
      case 'memory':
        return new MemoryUsageStorage(this.pluginOptions.maxEntries);
      case 'file':
        return new FileUsageStorage(this.pluginOptions.filePath);
      case 'remote':
        return new RemoteUsageStorage(
          this.pluginOptions.remoteEndpoint!,
          '',
          DEFAULT_REMOTE_TIMEOUT_MS,
          this.pluginOptions.remoteHeaders || {},
          this.pluginOptions.batchSize,
          this.pluginOptions.flushInterval,
        );
      case 'silent':
        return new SilentUsageStorage();
      default:
        throw new ConfigurationError('Unknown usage tracking strategy', {
          strategy: this.pluginOptions.strategy,
        });
    }
  }

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
          successRate: stats.successRate,
        });
      },
    );
  }
}
