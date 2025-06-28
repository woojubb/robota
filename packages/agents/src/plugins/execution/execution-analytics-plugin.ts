import { BasePlugin, type ErrorContext } from '../../abstracts/base-plugin';
import { Logger, createLogger } from '../../utils/logger';
import type { RunOptions } from '../../interfaces/agent';
import type { UniversalMessage } from '../../managers/conversation-history-manager';
import { isAssistantMessage } from '../../managers/conversation-history-manager';
import type { ToolParameters, ToolExecutionResult } from '../../interfaces/tool';

/**
 * Analytics context data for execution tracking
 */
export interface AnalyticsContextData {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    operation?: string;
    toolName?: string;
    parameterCount?: number;
    inputLength?: number;
    responseLength?: number;
    hasOptions?: boolean;
    hasError?: boolean;
    resultType?: string;
    errorSource?: string;
    contextType?: string;
    hasContext?: boolean;
    modelName?: string;
}

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
    metadata?: Record<string, string | number | boolean | Date | string[]>;
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
    private initialized = false;

    constructor(options: ExecutionAnalyticsOptions = {}) {
        super();
        this.options = {
            maxEntries: options.maxEntries || 1000,
            trackErrors: options.trackErrors ?? true,
            performanceThreshold: options.performanceThreshold || 5000,
            enableWarnings: options.enableWarnings ?? true
        };
        this.logger = createLogger('ExecutionAnalyticsPlugin');
        this.logger.info('ExecutionAnalyticsPlugin initialized', this.options);
        this.initialized = true;
    }

    /**
     * Called before agent run - start tracking
     */
    override async beforeRun(input: string, options?: RunOptions): Promise<void> {
        const executionId = this.generateExecutionId();

        this.activeExecutions.set(executionId, {
            startTime: Date.now(),
            operation: 'run',
            input: input.substring(0, 100) // Store first 100 chars
        });

        this.logger.debug('Started tracking run execution', {
            executionId,
            inputLength: input.length,
            hasOptions: !!options
        });
    }

    /**
     * Called after agent run - end tracking
     */
    override async afterRun(input: string, response: string, options?: RunOptions): Promise<void> {
        // Find the related execution
        const execution = this.findActiveExecution('run', input);

        if (!execution) {
            this.logger.warn('No active execution found for afterRun', { input: input.substring(0, 100) });
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
            success: true, // Run completed successfully
            metadata: {
                inputLength: input.length,
                responseLength: response.length,
                hasOptions: !!options,
                modelName: String(options?.metadata?.['model'] || 'unknown')
            }
        };

        this.recordStats(stats);
        this.activeExecutions.delete(executionId);

        // Performance warning
        if (this.options.enableWarnings && duration > this.options.performanceThreshold) {
            this.logger.warn('Slow run execution detected', {
                executionId,
                duration,
                threshold: this.options.performanceThreshold
            });
        }

        this.logger.debug('Completed tracking run execution', {
            executionId,
            duration,
            inputLength: input.length,
            responseLength: response.length
        });
    }

    /**
     * Called before provider call - start tracking
     */
    override async beforeProviderCall(messages: UniversalMessage[]): Promise<void> {
        const executionId = this.generateExecutionId('provider');

        this.activeExecutions.set(executionId, {
            startTime: Date.now(),
            operation: 'provider-call',
            input: messages[0]?.content || 'N/A'
        });

        this.logger.debug('Started tracking provider call', {
            executionId,
            inputLength: messages[0]?.content?.length || 0
        });
    }

    /**
     * Called after provider call - end tracking
     */
    override async afterProviderCall(messages: UniversalMessage[], response: UniversalMessage): Promise<void> {
        // Find the related execution
        const execution = this.findActiveExecution('provider-call', messages[0]?.content || '');

        if (!execution) {
            this.logger.warn('No active execution found for afterProviderCall');
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
            success: true, // Provider call completed
            metadata: {
                inputLength: messages[0]?.content?.length || 0,
                responseLength: response.content?.length || 0,
                hasToolCalls: !!(isAssistantMessage(response) && response.toolCalls && response.toolCalls.length > 0),
                toolCallCount: (isAssistantMessage(response) && response.toolCalls) ? response.toolCalls.length : 0
            }
        };

        this.recordStats(stats);
        this.activeExecutions.delete(executionId);

        // Performance warning
        if (this.options.enableWarnings && duration > this.options.performanceThreshold) {
            this.logger.warn('Slow provider call detected', {
                executionId,
                duration,
                threshold: this.options.performanceThreshold
            });
        }

        this.logger.debug('Completed tracking provider call', {
            executionId,
            duration
        });
    }

    /**
     * Called before tool call - start tracking
     */
    override async beforeToolCall(toolName: string, parameters: ToolParameters): Promise<void> {
        const executionId = this.generateExecutionId('tool');

        this.activeExecutions.set(executionId, {
            startTime: Date.now(),
            operation: 'tool-call',
            input: toolName
        });

        this.logger.debug('Started tracking tool call', {
            executionId,
            toolName,
            parameterCount: Object.keys(parameters).length
        });
    }

    /**
     * Called after tool call - end tracking
     */
    override async afterToolCall(toolName: string, parameters: ToolParameters, result: ToolExecutionResult): Promise<void> {
        // Find the related execution
        const execution = this.findActiveExecution('tool-call', toolName);

        if (!execution) {
            this.logger.warn('No active tool call found for afterToolCall', { toolName });
            return;
        }

        const { executionId, executionData } = execution;
        const endTime = Date.now();
        const duration = endTime - executionData.startTime;
        const success = !result?.error;

        const errorInfo = result?.error && this.options.trackErrors ? {
            message: String(result.error),
            // stack is optional in ExecutionStats interface
            type: 'ToolExecutionError'
        } : undefined;

        const stats: ExecutionStats = {
            executionId,
            operation: 'tool-call',
            startTime: new Date(executionData.startTime),
            endTime: new Date(endTime),
            duration,
            success,
            ...(errorInfo && { error: errorInfo }),
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
    override async onError(error: Error, context?: ErrorContext): Promise<void> {
        // Find any active execution that might be related to this error
        const activeExecution = Array.from(this.activeExecutions.entries())[0];

        if (activeExecution) {
            const [executionId, executionData] = activeExecution;
            const endTime = Date.now();
            const duration = endTime - executionData.startTime;

            const errorInfo = this.options.trackErrors ? {
                message: error.message,
                ...(error.stack && { stack: error.stack }),
                type: error.constructor.name
            } : undefined;

            const stats: ExecutionStats = {
                executionId,
                operation: executionData.operation,
                startTime: new Date(executionData.startTime),
                endTime: new Date(endTime),
                duration,
                success: false,
                ...(errorInfo && { error: errorInfo }),
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
        const operationStats: Record<string, {
            count: number;
            successCount: number;
            failureCount: number;
            totalDuration: number;
            averageDuration: number;
        }> = {};

        for (const stat of stats) {
            if (!operationStats[stat.operation]) {
                operationStats[stat.operation] = {
                    count: 0,
                    successCount: 0,
                    failureCount: 0,
                    totalDuration: 0,
                    averageDuration: 0
                };
            }

            const opStat = operationStats[stat.operation];
            if (opStat) {
                opStat.count++;
                opStat.totalDuration += stat.duration;

                if (stat.success) {
                    opStat.successCount++;
                } else {
                    opStat.failureCount++;
                }
            }
        }

        // Calculate averages for operations
        for (const op in operationStats) {
            const opStat = operationStats[op];
            if (opStat && opStat.count > 0) {
                opStat.averageDuration = opStat.totalDuration / opStat.count;
            }
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
                start: stats[0]?.startTime || new Date(),
                end: stats[stats.length - 1]?.endTime || new Date()
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
    getActiveExecutions(): Array<{ executionId: string; operation: string; duration: number }> {
        const now = Date.now();
        return Array.from(this.activeExecutions.entries()).map(([executionId, data]) => ({
            executionId,
            operation: data.operation,
            duration: now - data.startTime
        }));
    }

    /**
     * Get plugin performance statistics
     */
    getPluginStats(): {
        totalRecorded: number;
        activeExecutions: number;
        memoryUsage: number;
        oldestRecord?: Date;
        newestRecord?: Date;
    } {
        const result: {
            totalRecorded: number;
            activeExecutions: number;
            memoryUsage: number;
            oldestRecord?: Date;
            newestRecord?: Date;
        } = {
            totalRecorded: this.executionHistory.length,
            activeExecutions: this.activeExecutions.size,
            memoryUsage: this.getMemoryUsage()
        };

        if (this.executionHistory.length > 0) {
            const oldest = this.executionHistory[0];
            const newest = this.executionHistory[this.executionHistory.length - 1];
            if (oldest) {
                result.oldestRecord = oldest.startTime;
            }
            if (newest) {
                result.newestRecord = newest.endTime;
            }
        }

        return result;
    }

    /**
     * Clean up resources
     */
    async destroy(): Promise<void> {
        this.clearStats();
        this.logger.info('ExecutionAnalyticsPlugin destroyed');
    }

    /**
     * Get execution data for export
     */
    getExecutionData(): ExecutionStats[] {
        return [...this.executionHistory];
    }

    /**
     * Get analytics statistics
     */
    getAnalyticsStats(): AggregatedExecutionStats {
        return this.getAggregatedStats();
    }

    /**
     * Clear execution data
     */
    clearExecutionData(): void {
        this.clearStats();
    }

    /**
     * Get plugin status
     */
    override getStatus(): {
        name: string;
        version: string;
        enabled: boolean;
        initialized: boolean;
        totalRecorded: number;
        activeExecutions: number;
        memoryUsage: number;
    } {
        return {
            name: this.name,
            version: this.version,
            enabled: this.enabled,
            initialized: this.initialized,
            totalRecorded: this.executionHistory.length,
            activeExecutions: this.activeExecutions.size,
            memoryUsage: this.getMemoryUsage()
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

    private findActiveExecution(operation: string, input?: string): { executionId: string; executionData: { startTime: number; operation: string; input?: string } } | null {
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

    /**
     * Get memory usage estimate
     */
    private getMemoryUsage(): number {
        return this.executionHistory.length + this.activeExecutions.size;
    }
} 