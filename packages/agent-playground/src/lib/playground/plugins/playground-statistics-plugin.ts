const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_SLOW_EXECUTION_THRESHOLD_MS = 3000;
const DEFAULT_ERROR_RATE_THRESHOLD = 10;
const PERCENTAGE_MULTIPLIER = 100;
const TOP_ERRORS_COUNT = 5;
const INITIAL_SUCCESS_RATE = 100;

import type { ILogger, TUniversalValue } from '@robota-sdk/agent-core';
import { SilentLogger } from '@robota-sdk/agent-core';

import type {
  IPlaygroundAction,
  IPlaygroundExecutionResult,
  IPlaygroundMetrics,
  IPlaygroundStatisticsOptions,
  IPlaygroundStatisticsStats,
} from '../../../types/playground-statistics';

/**
 * PlaygroundStatisticsPlugin
 *
 * Standalone recorder for Playground metrics. This is intentionally not coupled
 * to the SDK plugin system; it just stores metrics for the Playground UI.
 */
export class PlaygroundStatisticsPlugin {
  private readonly logger: ILogger;
  private readonly options: Required<IPlaygroundStatisticsOptions>;

  private metrics: IPlaygroundMetrics;
  private executionHistory: IPlaygroundExecutionResult[] = [];
  private actionHistory: IPlaygroundAction[] = [];

  constructor(options: IPlaygroundStatisticsOptions = {}, logger: ILogger = SilentLogger) {
    this.logger = logger;
    this.options = {
      enabled: options.enabled ?? true,
      collectUIMetrics: options.collectUIMetrics ?? true,
      collectBlockMetrics: options.collectBlockMetrics ?? true,
      collectConfigMetrics: options.collectConfigMetrics ?? true,
      trackResponseTime: options.trackResponseTime ?? true,
      trackExecutionDetails: options.trackExecutionDetails ?? true,
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      aggregateStats: options.aggregateStats ?? true,
      resetOnSessionStart: options.resetOnSessionStart ?? false,
      slowExecutionThreshold: options.slowExecutionThreshold ?? DEFAULT_SLOW_EXECUTION_THRESHOLD_MS,
      errorRateThreshold: options.errorRateThreshold ?? DEFAULT_ERROR_RATE_THRESHOLD,
    };

    this.metrics = {
      totalChatExecutions: 0,
      agentModeExecutions: 0,
      teamModeExecutions: 0,
      streamingExecutions: 0,
      blockCreations: 0,
      uiInteractions: 0,
      configChanges: 0,
      averageResponseTime: 0,
      lastExecutionTime: null,
      errorCount: 0,
      successRate: INITIAL_SUCCESS_RATE,
      isActive: false,
      lastUpdated: new Date(),
    };
  }

  async recordPlaygroundExecution(result: IPlaygroundExecutionResult): Promise<void> {
    if (!this.options.enabled) return;

    this.executionHistory.push(result);
    if (this.executionHistory.length > this.options.maxEntries) {
      this.executionHistory = this.executionHistory.slice(
        this.executionHistory.length - this.options.maxEntries,
      );
    }

    this.metrics.totalChatExecutions += 1;
    this.metrics.agentModeExecutions += result.mode === 'agent' ? 1 : 0;
    this.metrics.teamModeExecutions += result.mode === 'team' ? 1 : 0;
    this.metrics.streamingExecutions += result.streaming ? 1 : 0;
    this.metrics.errorCount += result.success ? 0 : 1;
    this.metrics.lastExecutionTime = result.duration;
    this.metrics.averageResponseTime = this.calculateAverageResponseTime();
    this.metrics.successRate = this.calculateSuccessRate();
    this.metrics.lastUpdated = new Date();
  }

  async recordUIInteraction(
    type: IPlaygroundAction['type'],
    metadata?: Record<string, TUniversalValue>,
  ): Promise<void> {
    if (!this.options.enabled || !this.options.collectUIMetrics) return;

    this.actionHistory.push({ type, timestamp: new Date(), metadata });
    if (this.actionHistory.length > this.options.maxEntries) {
      this.actionHistory = this.actionHistory.slice(
        this.actionHistory.length - this.options.maxEntries,
      );
    }

    this.metrics.uiInteractions += 1;
    this.metrics.lastUpdated = new Date();
  }

  async recordBlockCreation(
    _blockType: string,
    _metadata?: Record<string, TUniversalValue>,
  ): Promise<void> {
    if (!this.options.enabled || !this.options.collectBlockMetrics) return;

    this.metrics.blockCreations += 1;
    this.metrics.lastUpdated = new Date();
  }

  getPlaygroundStats(): IPlaygroundStatisticsStats {
    return {
      metrics: { ...this.metrics },
      executionHistory: [...this.executionHistory],
      actionHistory: [...this.actionHistory],
      aggregatedStats: this.calculateAggregatedStats(),
      timeBasedStats: this.calculateTimeBasedStats(),
    };
  }

  resetStatistics(): void {
    this.metrics.totalChatExecutions = 0;
    this.metrics.agentModeExecutions = 0;
    this.metrics.teamModeExecutions = 0;
    this.metrics.streamingExecutions = 0;
    this.metrics.blockCreations = 0;
    this.metrics.uiInteractions = 0;
    this.metrics.configChanges = 0;
    this.metrics.averageResponseTime = 0;
    this.metrics.lastExecutionTime = null;
    this.metrics.errorCount = 0;
    this.metrics.successRate = INITIAL_SUCCESS_RATE;
    this.metrics.isActive = false;
    this.metrics.lastUpdated = new Date();

    this.executionHistory = [];
    this.actionHistory = [];
  }

  private calculateSuccessRate(): number {
    if (this.metrics.totalChatExecutions === 0) return INITIAL_SUCCESS_RATE;
    const successCount = this.metrics.totalChatExecutions - this.metrics.errorCount;
    return Math.round((successCount / this.metrics.totalChatExecutions) * PERCENTAGE_MULTIPLIER);
  }

  private calculateAverageResponseTime(): number {
    if (this.executionHistory.length === 0) return 0;
    const totalTime = this.executionHistory.reduce((sum, exec) => sum + exec.duration, 0);
    return Math.round(totalTime / this.executionHistory.length);
  }

  private calculateAggregatedStats(): IPlaygroundStatisticsStats['aggregatedStats'] {
    const providerUsage: Record<string, number> = {};
    const modelUsage: Record<string, number> = {};
    const errorCounts: Record<string, number> = {};

    for (const exec of this.executionHistory) {
      providerUsage[exec.provider] = (providerUsage[exec.provider] ?? 0) + 1;
      modelUsage[exec.model] = (modelUsage[exec.model] ?? 0) + 1;
      if (!exec.success && exec.error) {
        errorCounts[exec.error] = (errorCounts[exec.error] ?? 0) + 1;
      }
    }

    const topErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_ERRORS_COUNT)
      .map(([error, count]) => ({ error, count }));

    return {
      sessionsCount: 1,
      totalExecutionTime: this.executionHistory.reduce((sum, exec) => sum + exec.duration, 0),
      averageSessionDuration: this.executionHistory.reduce((sum, exec) => sum + exec.duration, 0),
      topErrors,
      providerUsage,
      modelUsage,
    };
  }

  private calculateTimeBasedStats(): IPlaygroundStatisticsStats['timeBasedStats'] {
    const hourlyExecutions = Array.from({ length: 24 }, () => 0);
    const dailyExecutions = Array.from({ length: 7 }, () => 0);

    for (const exec of this.executionHistory) {
      const d = exec.timestamp;
      hourlyExecutions[d.getHours()] += 1;
      dailyExecutions[d.getDay()] += 1;
    }

    let peakUsageHour = 0;
    for (let i = 1; i < hourlyExecutions.length; i += 1) {
      if (hourlyExecutions[i] > hourlyExecutions[peakUsageHour]) {
        peakUsageHour = i;
      }
    }

    return {
      hourlyExecutions,
      dailyExecutions,
      peakUsageHour,
    };
  }
}
