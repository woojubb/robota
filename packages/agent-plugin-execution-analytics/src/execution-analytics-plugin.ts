import {
  AbstractPlugin,
  PluginCategory,
  PluginPriority,
  type IPluginErrorContext,
  createLogger,
  type ILogger,
  type IRunOptions,
  type TUniversalMessage,
  isAssistantMessage,
  type TToolParameters,
  type IToolExecutionResult,
} from '@robota-sdk/agent-core';
import type {
  IExecutionStats,
  IAggregatedExecutionStats,
  IExecutionAnalyticsOptions,
  IExecutionAnalyticsPluginStats,
} from './types';
import { aggregateExecutionStats } from './analytics-aggregation';
import {
  validateExecutionAnalyticsOptions,
  generateExecutionId,
  findActiveExecution,
  buildErrorExecutionStats,
} from './execution-analytics-helpers';

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_PERFORMANCE_THRESHOLD_MS = 5000;
const PREVIEW_LENGTH = 100;

/**
 * Tracks timing and success/failure of agent runs, provider calls, and tool executions.
 * @extends AbstractPlugin
 */
export class ExecutionAnalyticsPlugin extends AbstractPlugin<
  IExecutionAnalyticsOptions,
  IExecutionAnalyticsPluginStats
> {
  name = 'ExecutionAnalyticsPlugin';
  version = '1.0.0';

  private pluginOptions: Required<IExecutionAnalyticsOptions>;
  private logger: ILogger;
  private activeExecutions: Map<string, { startTime: number; operation: string; input?: string }> =
    new Map();
  private executionHistory: IExecutionStats[] = [];
  private executionCounter = 0;
  private initialized = false;

  constructor(options: IExecutionAnalyticsOptions = {}) {
    super();
    this.category = PluginCategory.MONITORING;
    this.priority = PluginPriority.NORMAL;
    this.pluginOptions = {
      enabled: options.enabled ?? true,
      maxEntries: options.maxEntries || DEFAULT_MAX_ENTRIES,
      trackErrors: options.trackErrors ?? true,
      performanceThreshold: options.performanceThreshold || DEFAULT_PERFORMANCE_THRESHOLD_MS,
      enableWarnings: options.enableWarnings ?? true,
      category: options.category ?? PluginCategory.MONITORING,
      priority: options.priority ?? PluginPriority.NORMAL,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
    };
    validateExecutionAnalyticsOptions(options, this.pluginOptions);
    this.logger = createLogger('ExecutionAnalyticsPlugin');
    this.beforeRun = this.beforeRun.bind(this);
    this.afterRun = this.afterRun.bind(this);
    this.beforeProviderCall = this.beforeProviderCall.bind(this);
    this.afterProviderCall = this.afterProviderCall.bind(this);
    this.initialized = true;
  }

  override beforeRun = async (input: string, _options?: IRunOptions): Promise<void> => {
    this.activeExecutions.set(generateExecutionId('exec', ++this.executionCounter), {
      startTime: Date.now(),
      operation: 'run',
      input: input.substring(0, PREVIEW_LENGTH),
    });
  };

  override afterRun = async (
    input: string,
    response: string,
    options?: IRunOptions,
  ): Promise<void> => {
    const execution = findActiveExecution(this.activeExecutions, 'run', input);
    if (!execution) return;
    const { executionId, executionData } = execution;
    const duration = Date.now() - executionData.startTime;
    this.recordStats({
      executionId,
      operation: 'run',
      startTime: new Date(executionData.startTime),
      endTime: new Date(),
      duration,
      success: true,
      metadata: {
        inputLength: input.length,
        responseLength: response.length,
        hasOptions: !!options,
        modelName: String(options?.metadata?.['model'] || 'unknown'),
      },
    });
    this.activeExecutions.delete(executionId);
    if (this.pluginOptions.enableWarnings && duration > this.pluginOptions.performanceThreshold) {
      this.logger.warn('Slow run execution detected', {
        executionId,
        duration,
        threshold: this.pluginOptions.performanceThreshold,
      });
    }
  };

  override beforeProviderCall = async (messages: TUniversalMessage[]): Promise<void> => {
    this.activeExecutions.set(generateExecutionId('provider', ++this.executionCounter), {
      startTime: Date.now(),
      operation: 'provider-call',
      input: messages[0]?.content || 'N/A',
    });
  };

  override afterProviderCall = async (
    messages: TUniversalMessage[],
    response: TUniversalMessage,
  ): Promise<void> => {
    const execution = findActiveExecution(
      this.activeExecutions,
      'provider-call',
      messages[0]?.content || '',
    );
    if (!execution) return;
    const { executionId, executionData } = execution;
    const duration = Date.now() - executionData.startTime;
    this.recordStats({
      executionId,
      operation: 'provider-call',
      startTime: new Date(executionData.startTime),
      endTime: new Date(),
      duration,
      success: true,
      metadata: {
        inputLength: messages[0]?.content?.length || 0,
        responseLength: response.content?.length || 0,
        hasToolCalls: !!(
          isAssistantMessage(response) &&
          response.toolCalls &&
          response.toolCalls.length > 0
        ),
        toolCallCount:
          isAssistantMessage(response) && response.toolCalls ? response.toolCalls.length : 0,
      },
    });
    this.activeExecutions.delete(executionId);
    if (this.pluginOptions.enableWarnings && duration > this.pluginOptions.performanceThreshold) {
      this.logger.warn('Slow provider call detected', {
        executionId,
        duration,
        threshold: this.pluginOptions.performanceThreshold,
      });
    }
  };

  override async beforeToolCall(toolName: string, _parameters: TToolParameters): Promise<void> {
    this.activeExecutions.set(generateExecutionId('tool', ++this.executionCounter), {
      startTime: Date.now(),
      operation: 'tool-call',
      input: toolName,
    });
  }

  override async afterToolCall(
    toolName: string,
    parameters: TToolParameters,
    result: IToolExecutionResult,
  ): Promise<void> {
    const execution = findActiveExecution(this.activeExecutions, 'tool-call', toolName);
    if (!execution) return;
    const { executionId, executionData } = execution;
    const duration = Date.now() - executionData.startTime;
    const success = !result?.error;
    const errorInfo =
      result?.error && this.pluginOptions.trackErrors
        ? { message: String(result.error), type: 'ToolExecutionError' }
        : undefined;
    this.recordStats({
      executionId,
      operation: 'tool-call',
      startTime: new Date(executionData.startTime),
      endTime: new Date(),
      duration,
      success,
      ...(errorInfo && { error: errorInfo }),
      metadata: {
        toolName,
        parameterCount: Object.keys(parameters).length,
        resultType: typeof result,
        hasError: !!result?.error,
      },
    });
    this.activeExecutions.delete(executionId);
  }

  override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
    const activeExecution = Array.from(this.activeExecutions.entries())[0];
    if (activeExecution) {
      const [executionId, executionData] = activeExecution;
      this.recordStats(
        buildErrorExecutionStats(
          executionId,
          executionData,
          error,
          this.pluginOptions.trackErrors,
          context,
        ),
      );
      this.activeExecutions.delete(executionId);
    }
  }

  getExecutionStats(operation?: string, timeRange?: { start: Date; end: Date }): IExecutionStats[] {
    let filtered = this.executionHistory;
    if (operation) filtered = filtered.filter((stat) => stat.operation === operation);
    if (timeRange)
      filtered = filtered.filter(
        (stat) => stat.startTime >= timeRange.start && stat.startTime <= timeRange.end,
      );
    return [...filtered];
  }

  getAggregatedStats(timeRange?: { start: Date; end: Date }): IAggregatedExecutionStats {
    return aggregateExecutionStats(this.getExecutionStats(undefined, timeRange), timeRange);
  }

  clearStats(): void {
    this.executionHistory = [];
    this.activeExecutions.clear();
    this.executionCounter = 0;
  }

  getActiveExecutions(): Array<{ executionId: string; operation: string; duration: number }> {
    const now = Date.now();
    return Array.from(this.activeExecutions.entries()).map(([executionId, data]) => ({
      executionId,
      operation: data.operation,
      duration: now - data.startTime,
    }));
  }

  getPluginStats(): {
    totalRecorded: number;
    activeExecutions: number;
    memoryUsage: number;
    oldestRecord?: Date;
    newestRecord?: Date;
  } {
    const oldest = this.executionHistory[0];
    const newest = this.executionHistory[this.executionHistory.length - 1];
    return {
      totalRecorded: this.executionHistory.length,
      activeExecutions: this.activeExecutions.size,
      memoryUsage: this.executionHistory.length + this.activeExecutions.size,
      ...(oldest && { oldestRecord: oldest.startTime }),
      ...(newest && { newestRecord: newest.endTime }),
    };
  }

  async destroy(): Promise<void> {
    this.clearStats();
  }
  getExecutionData(): IExecutionStats[] {
    return [...this.executionHistory];
  }
  getAnalyticsStats(): IAggregatedExecutionStats {
    return this.getAggregatedStats();
  }
  clearExecutionData(): void {
    this.clearStats();
  }

  override getStatus() {
    return {
      name: this.name,
      version: this.version,
      enabled: this.enabled,
      initialized: this.initialized,
      category: this.category,
      priority: this.priority,
      subscribedEventsCount: this.subscribedEvents.length,
      hasEventEmitter: !!this.eventEmitter,
    };
  }

  override getStats(): IExecutionAnalyticsPluginStats {
    const newest = this.executionHistory[this.executionHistory.length - 1];
    const oldest = this.executionHistory[0];
    return {
      enabled: this.enabled,
      calls: this.executionHistory.length,
      errors: this.executionHistory.filter((e) => !e.success).length,
      ...(newest?.endTime && { lastActivity: newest.endTime }),
      totalRecorded: this.executionHistory.length,
      activeExecutions: this.activeExecutions.size,
      memoryUsage: this.executionHistory.length + this.activeExecutions.size,
      ...(oldest && { oldestRecord: oldest.startTime }),
      ...(newest && { newestRecord: newest.endTime }),
    };
  }

  private recordStats(stats: IExecutionStats): void {
    this.executionHistory.push(stats);
    if (this.executionHistory.length > this.pluginOptions.maxEntries) this.executionHistory.shift();
  }
}
