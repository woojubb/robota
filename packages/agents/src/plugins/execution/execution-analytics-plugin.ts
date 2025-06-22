import { BasePlugin } from '../../abstracts/base-plugin.js';
import { Logger } from '../../utils/logger.js';
import { PluginError } from '../../utils/errors.js';
import type { RunOptions } from '../../interfaces/agent.js';
import type { Context, ModelResponse } from '../../interfaces/provider.js';

/**
 * Execution statistics entry
 */
export interface ExecutionStats {
    executionId: string;
    operation: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    success: boolean;
    error?: {
        message: string;
        stack?: string;
        type: string;
    };
    metadata?: Record<string, any>;
}

/**
 * Aggregated execution statistics
 */
export interface AggregatedExecutionStats {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    successRate: number;
    averageDuration: number;
    totalDuration: number;
    operationStats: Record<string, {
        count: number;
        successCount: number;
        failureCount: number;
        averageDuration: number;
        totalDuration: number;
    }>;
    errorStats: Record<string, number>;
    timeRange: {
        start: Date;
        end: Date;
    };
}

/**
 * Plugin options
 */
export interface ExecutionAnalyticsOptions {
    /** Maximum number of entries to keep in memory */
    maxEntries?: number;
    /** Whether to track error details */
    trackErrors?: boolean;
    /** Performance threshold in milliseconds for warnings */
    performanceThreshold?: number;
    /** Enable performance warnings */
    enableWarnings?: boolean;
}

/**
 * Plugin for tracking execution analytics automatically
 * Integrates with agent lifecycle to track performance without manual intervention
 */
export class ExecutionAnalyticsPlugin extends BasePlugin {
    name = 'ExecutionAnalyticsPlugin';
    version = '1.0.0';

    private options: Required<ExecutionAnalyticsOptions>;
    private logger: Logger;
    private activeExecutions: Map<string, { startTime: number; operation: string; input?: string }> = new Map();
    private executionHistory: ExecutionStats[] = [];
    private executionCounter = 0;

    constructor(options: ExecutionAnalyticsOptions = {}) {
        super();
        this.logger = new Logger('ExecutionAnalyticsPlugin');

        // Set defaults
        this.options = {
            maxEntries: options.maxEntries ?? 1000,
            trackErrors: options.trackErrors ?? true,
            performanceThreshold: options.performanceThreshold ?? 1000, // 1 second
            enableWarnings: options.enableWarnings ?? true,
        };

        this.logger.info('ExecutionAnalyticsPlugin initialized', {
            maxEntries: this.options.maxEntries,
            trackErrors: this.options.trackErrors,
            performanceThreshold: this.options.performanceThreshold
        });
    }

    /**
     * Called before agent run - start tracking
     */
    async beforeRun(input: string, options?: RunOptions): Promise<void> {
        const executionId = this.generateExecutionId();

        this.activeExecutions.set(executionId, {
            startTime: Date.now(),
            operation: 'run',
            input
        });

        this.logger.debug('Started tracking execution', {
            executionId,
            inputLength: input.length,
            options: options ? Object.keys(options) : []
        });
    }

    /**
     * Called after agent run - end tracking with success
     */
    async afterRun(input: string, response: string, options?: RunOptions): Promise<void> {
        const execution = this.findActiveExecution('run', input);
        if (!execution) {
            this.logger.warn('No active execution found for afterRun', { inputLength: input.length });
            return;
        }

        const { executionId, executionData } = execution;
        const endTime = Date.now();
        const duration = endTime - executionData.startTime;

        const stats: ExecutionStats = {
            executionId,
            operation: 'run',
            startTime: new Date(executionData.startTime),
            endTime: new Date(endTime),
            duration,
            success: true,
            metadata: {
                inputLength: input.length,
                responseLength: response.length,
                hasOptions: !!options,
                optionKeys: options ? Object.keys(options) : []
            }
        };

        this.recordStats(stats);
        this.activeExecutions.delete(executionId);

        // Log warning if performance threshold exceeded
        if (this.options.enableWarnings && duration > this.options.performanceThreshold) {
            this.logger.warn('Performance threshold exceeded', {
                executionId,
                duration,
                threshold: this.options.performanceThreshold,
                inputLength: input.length
            });
        }

        this.logger.debug('Completed tracking execution', {
            executionId,
            duration,
            success: true
        });
    }

    /**
     * Called before AI provider call - track provider interaction
     */
    async beforeProviderCall(context: Context): Promise<void> {
        const executionId = this.generateExecutionId('provider');

        this.activeExecutions.set(executionId, {
            startTime: Date.now(),
            operation: 'provider-call'
        });

        this.logger.debug('Started tracking provider call', {
            executionId,
            messageCount: context.messages?.length || 0,
            hasSystemMessage: !!context.systemMessage,
            toolCount: context.tools?.length || 0
        });
    }

    /**
     * Called after AI provider call - end tracking provider interaction
     */
    async afterProviderCall(context: Context, response: ModelResponse): Promise<void> {
        const execution = this.findActiveExecution('provider-call');
        if (!execution) {
            this.logger.warn('No active provider call found for afterProviderCall');
            return;
        }

        const { executionId, executionData } = execution;
        const endTime = Date.now();
        const duration = endTime - executionData.startTime;

        const stats: ExecutionStats = {
            executionId,
            operation: 'provider-call',
            startTime: new Date(executionData.startTime),
            endTime: new Date(endTime),
            duration,
            success: true,
            metadata: {
                model: response.metadata?.model || 'unknown',
                messageCount: context.messages?.length || 0,
                responseLength: response.content?.length || 0,
                tokensUsed: response.usage?.totalTokens,
                hasToolCalls: !!(response.toolCalls && response.toolCalls.length > 0),
                toolCallCount: response.toolCalls?.length || 0,
                hasSystemMessage: !!context.systemMessage,
                availableToolCount: context.tools?.length || 0
            }
        };

        this.recordStats(stats);
        this.activeExecutions.delete(executionId);

        this.logger.debug('Completed tracking provider call', {
            executionId,
            duration,
            tokensUsed: response.usage?.totalTokens,
            model: response.metadata?.model
        });
    }

    /**
     * Called before tool execution
     */
    async beforeToolCall(toolName: string, parameters: Record<string, any>): Promise<void> {
        const executionId = this.generateExecutionId('tool');

        this.activeExecutions.set(executionId, {
            startTime: Date.now(),
            operation: 'tool-call'
        });

        this.logger.debug('Started tracking tool call', {
            executionId,
            toolName,
            parameterCount: Object.keys(parameters).length
        });
    }

    /**
     * Called after tool execution
     */
    async afterToolCall(toolName: string, parameters: Record<string, any>, result: any): Promise<void> {
        const execution = this.findActiveExecution('tool-call');
        if (!execution) {
            this.logger.warn('No active tool call found for afterToolCall', { toolName });
            return;
        }

        const { executionId, executionData } = execution;
        const endTime = Date.now();
        const duration = endTime - executionData.startTime;
        const success = !result?.error;

        const stats: ExecutionStats = {
            executionId,
            operation: 'tool-call',
            startTime: new Date(executionData.startTime),
            endTime: new Date(endTime),
            duration,
            success,
            error: result?.error && this.options.trackErrors ? {
                message: result.error.message || String(result.error),
                stack: result.error.stack,
                type: result.error.constructor?.name || 'Error'
            } : undefined,
            metadata: {
                toolName,
                parameterCount: Object.keys(parameters).length,
                resultType: typeof result,
                hasError: !!result?.error
            }
        };

        this.recordStats(stats);
        this.activeExecutions.delete(executionId);

        this.logger.debug('Completed tracking tool call', {
            executionId,
            duration,
            toolName,
            success
        });
    }

    /**
     * Called on error - end tracking with error
     */
    async onError(error: Error, context?: any): Promise<void> {
        // Find any active execution that might be related to this error
        const activeExecution = Array.from(this.activeExecutions.entries())[0];

        if (activeExecution) {
            const [executionId, executionData] = activeExecution;
            const endTime = Date.now();
            const duration = endTime - executionData.startTime;

            const stats: ExecutionStats = {
                executionId,
                operation: executionData.operation,
                startTime: new Date(executionData.startTime),
                endTime: new Date(endTime),
                duration,
                success: false,
                error: this.options.trackErrors ? {
                    message: error.message,
                    stack: error.stack,
                    type: error.constructor.name
                } : undefined,
                metadata: {
                    errorSource: 'onError-hook',
                    contextType: context ? typeof context : 'none',
                    hasContext: !!context
                }
            };

            this.recordStats(stats);
            this.activeExecutions.delete(executionId);

            this.logger.error('Execution failed with error', {
                executionId,
                duration,
                operation: executionData.operation,
                error: error.message
            });
        } else {
            this.logger.warn('Error occurred but no active execution found', {
                error: error.message
            });
        }
    }

    /**
     * Get execution statistics
     */
    getExecutionStats(operation?: string, timeRange?: { start: Date; end: Date }): ExecutionStats[] {
        let filtered = this.executionHistory;

        if (operation) {
            filtered = filtered.filter(stat => stat.operation === operation);
        }

        if (timeRange) {
            filtered = filtered.filter(stat =>
                stat.startTime >= timeRange.start && stat.startTime <= timeRange.end
            );
        }

        return [...filtered];
    }

    /**
     * Get aggregated execution statistics
     */
    getAggregatedStats(timeRange?: { start: Date; end: Date }): AggregatedExecutionStats {
        const stats = this.getExecutionStats(undefined, timeRange);

        if (stats.length === 0) {
            return {
                totalExecutions: 0,
                successfulExecutions: 0,
                failedExecutions: 0,
                successRate: 0,
                averageDuration: 0,
                totalDuration: 0,
                operationStats: {},
                errorStats: {},
                timeRange: timeRange || {
                    start: new Date(),
                    end: new Date()
                }
            };
        }

        const totalExecutions = stats.length;
        const successfulExecutions = stats.filter(s => s.success).length;
        const failedExecutions = totalExecutions - successfulExecutions;
        const totalDuration = stats.reduce((sum, s) => sum + s.duration, 0);
        const averageDuration = totalDuration / totalExecutions;

        // Operation statistics
        const operationStats: Record<string, any> = {};
        for (const stat of stats) {
            if (!operationStats[stat.operation]) {
                operationStats[stat.operation] = {
                    count: 0,
                    successCount: 0,
                    failureCount: 0,
                    totalDuration: 0
                };
            }

            const opStat = operationStats[stat.operation];
            opStat.count++;
            opStat.totalDuration += stat.duration;

            if (stat.success) {
                opStat.successCount++;
            } else {
                opStat.failureCount++;
            }
        }

        // Calculate averages for operations
        for (const op in operationStats) {
            operationStats[op].averageDuration = operationStats[op].totalDuration / operationStats[op].count;
        }

        // Error statistics
        const errorStats: Record<string, number> = {};
        for (const stat of stats.filter(s => !s.success && s.error)) {
            const errorType = stat.error!.type;
            errorStats[errorType] = (errorStats[errorType] || 0) + 1;
        }

        return {
            totalExecutions,
            successfulExecutions,
            failedExecutions,
            successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
            averageDuration,
            totalDuration,
            operationStats,
            errorStats,
            timeRange: timeRange || {
                start: stats[0].startTime,
                end: stats[stats.length - 1].endTime
            }
        };
    }

    /**
     * Clear all statistics
     */
    clearStats(): void {
        this.executionHistory = [];
        this.activeExecutions.clear();
        this.executionCounter = 0;
        this.logger.info('Execution statistics cleared');
    }

    /**
     * Get currently active executions
     */
    getActiveExecutions(): Array<{ executionId: string; operation: string; startTime: Date; duration: number }> {
        const now = Date.now();
        return Array.from(this.activeExecutions.entries()).map(([executionId, execution]) => ({
            executionId,
            operation: execution.operation,
            startTime: new Date(execution.startTime),
            duration: now - execution.startTime
        }));
    }

    /**
     * Get plugin statistics summary
     */
    getPluginStats(): {
        totalRecorded: number;
        activeExecutions: number;
        memoryUsage: number;
        oldestRecord?: Date;
        newestRecord?: Date;
    } {
        return {
            totalRecorded: this.executionHistory.length,
            activeExecutions: this.activeExecutions.size,
            memoryUsage: this.executionHistory.length + this.activeExecutions.size,
            oldestRecord: this.executionHistory.length > 0 ? this.executionHistory[0].startTime : undefined,
            newestRecord: this.executionHistory.length > 0 ? this.executionHistory[this.executionHistory.length - 1].startTime : undefined
        };
    }

    /**
     * Plugin cleanup
     */
    async destroy(): Promise<void> {
        this.clearStats();
        this.logger.info('ExecutionAnalyticsPlugin destroyed');
    }

    // BasePlugin common interface implementations

    /**
     * Get plugin data - returns execution history
     */
    getData(): ExecutionStats[] {
        return [...this.executionHistory];
    }

    /**
     * Get plugin statistics - returns aggregated stats (common interface)
     */
    getStats(): AggregatedExecutionStats {
        return this.getAggregatedStats();
    }

    /**
     * Clear plugin data - clears all execution data
     */
    clearData(): void {
        this.clearStats();
    }

    /**
     * Get plugin status with analytics-specific information
     */
    getStatus(): {
        name: string;
        version: string;
        enabled: boolean;
        initialized: boolean;
        totalRecorded: number;
        activeExecutions: number;
        memoryUsage: number;
    } {
        const baseStatus = super.getStatus();
        const pluginStats = this.getPluginStats();

        return {
            ...baseStatus,
            totalRecorded: pluginStats.totalRecorded,
            activeExecutions: pluginStats.activeExecutions,
            memoryUsage: pluginStats.memoryUsage
        };
    }

    // Helper methods

    private recordStats(stats: ExecutionStats): void {
        this.executionHistory.push(stats);

        // Maintain max entries limit
        if (this.executionHistory.length > this.options.maxEntries) {
            this.executionHistory.shift();
        }

        this.logger.debug('Execution stats recorded', {
            executionId: stats.executionId,
            operation: stats.operation,
            duration: stats.duration,
            success: stats.success
        });
    }

    private generateExecutionId(prefix: string = 'exec'): string {
        return `${prefix}-${Date.now()}-${++this.executionCounter}`;
    }

    private findActiveExecution(operation: string, input?: string): { executionId: string; executionData: any } | null {
        for (const [executionId, executionData] of this.activeExecutions.entries()) {
            if (executionData.operation === operation) {
                // For 'run' operations, also match input if provided
                if (operation === 'run' && input && executionData.input !== input) {
                    continue;
                }
                return { executionId, executionData };
            }
        }
        return null;
    }
} 