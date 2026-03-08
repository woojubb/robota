import { AbstractPlugin, PluginCategory, PluginPriority, type IPluginErrorContext } from '../../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../../utils/logger';
import type { IRunOptions } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import { isAssistantMessage } from '../../managers/conversation-history-manager';
import type { TToolParameters, IToolExecutionResult } from '../../interfaces/tool';
import type {
    IExecutionStats,
    IAggregatedExecutionStats,
    IExecutionAnalyticsOptions,
    IExecutionAnalyticsPluginStats
} from './types';



/**
 * Automatically tracks timing and success/failure of agent runs, provider
 * calls, and tool executions by hooking into the agent lifecycle.
 *
 * Maintains an in-memory history capped at
 * {@link IExecutionAnalyticsOptions.maxEntries | maxEntries}. Emits warnings
 * when any operation exceeds
 * {@link IExecutionAnalyticsOptions.performanceThreshold | performanceThreshold} ms.
 *
 * Lifecycle hooks used: {@link AbstractPlugin.beforeRun | beforeRun},
 * {@link AbstractPlugin.afterRun | afterRun},
 * {@link AbstractPlugin.beforeProviderCall | beforeProviderCall},
 * {@link AbstractPlugin.afterProviderCall | afterProviderCall},
 * {@link AbstractPlugin.beforeToolCall | beforeToolCall},
 * {@link AbstractPlugin.afterToolCall | afterToolCall},
 * {@link AbstractPlugin.onError | onError}
 *
 * @extends AbstractPlugin
 * @see IExecutionAnalyticsOptions - configuration options
 * @see IExecutionStats - individual execution record
 * @see IAggregatedExecutionStats - aggregated analytics
 *
 * @example
 * ```ts
 * const plugin = new ExecutionAnalyticsPlugin({ maxEntries: 500 });
 * // Attach to agent -- hooks fire automatically
 * const stats = plugin.getAggregatedStats();
 * ```
 */
export class ExecutionAnalyticsPlugin extends AbstractPlugin<IExecutionAnalyticsOptions, IExecutionAnalyticsPluginStats> {
    name = 'ExecutionAnalyticsPlugin';
    version = '1.0.0';

    private pluginOptions: Required<IExecutionAnalyticsOptions>;
    private logger: ILogger;
    private activeExecutions: Map<string, { startTime: number; operation: string; input?: string }> = new Map();
    private executionHistory: IExecutionStats[] = [];
    private executionCounter = 0;
    private initialized = false;

    constructor(options: IExecutionAnalyticsOptions = {}) {
        super();

        // Set plugin classification
        this.category = PluginCategory.MONITORING;
        this.priority = PluginPriority.NORMAL;

        // Validate options
        this.validateOptions(options);

        this.pluginOptions = {
            enabled: options.enabled ?? true,
            maxEntries: options.maxEntries || 1000,
            trackErrors: options.trackErrors ?? true,
            performanceThreshold: options.performanceThreshold || 5000,
            enableWarnings: options.enableWarnings ?? true,
            // Add plugin options defaults
            category: options.category ?? PluginCategory.MONITORING,
            priority: options.priority ?? PluginPriority.NORMAL,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
        };
        this.logger = createLogger('ExecutionAnalyticsPlugin');

        // Bind methods to ensure proper 'this' context
        this.beforeRun = this.beforeRun.bind(this);
        this.afterRun = this.afterRun.bind(this);
        this.beforeProviderCall = this.beforeProviderCall.bind(this);
        this.afterProviderCall = this.afterProviderCall.bind(this);

        this.logger.info('ExecutionAnalyticsPlugin initialized', {
            maxEntries: this.pluginOptions.maxEntries,
            trackErrors: this.pluginOptions.trackErrors,
            performanceThreshold: this.pluginOptions.performanceThreshold,
            enableWarnings: this.pluginOptions.enableWarnings
        });
        this.initialized = true;
    }

    /**
     * Begins tracking a run execution, storing the start time and first 100
     * characters of input.
     */
    override beforeRun = async (input: string, options?: IRunOptions): Promise<void> => {
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
     * Completes tracking for a run execution, recording duration and metadata.
     * Logs a warning if the duration exceeds the performance threshold.
     */
    override afterRun = async (input: string, response: string, options?: IRunOptions): Promise<void> => {
        // Find the related execution
        const execution = this.findActiveExecution('run', input);

        if (!execution) {
            this.logger.warn('No active execution found for afterRun', { input: input.substring(0, 100) });
            return;
        }

        const { executionId, executionData } = execution;
        const endTime = Date.now();
        const duration = endTime - executionData.startTime;

        const stats: IExecutionStats = {
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
        if (this.pluginOptions.enableWarnings && duration > this.pluginOptions.performanceThreshold) {
            this.logger.warn('Slow run execution detected', {
                executionId,
                duration,
                threshold: this.pluginOptions.performanceThreshold
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
     * Begins tracking an LLM provider call.
     */
    override beforeProviderCall = async (messages: TUniversalMessage[]): Promise<void> => {
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
     * Completes tracking for a provider call, recording duration and tool call
     * metadata. Logs a warning if the duration exceeds the performance threshold.
     */
    override afterProviderCall = async (messages: TUniversalMessage[], response: TUniversalMessage): Promise<void> => {
        // Find the related execution
        const execution = this.findActiveExecution('provider-call', messages[0]?.content || '');

        if (!execution) {
            this.logger.warn('No active execution found for afterProviderCall');
            return;
        }

        const { executionId, executionData } = execution;
        const endTime = Date.now();
        const duration = endTime - executionData.startTime;

        const stats: IExecutionStats = {
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
        if (this.pluginOptions.enableWarnings && duration > this.pluginOptions.performanceThreshold) {
            this.logger.warn('Slow provider call detected', {
                executionId,
                duration,
                threshold: this.pluginOptions.performanceThreshold
            });
        }

        this.logger.debug('Completed tracking provider call', {
            executionId,
            duration
        });
    }

    /**
     * Begins tracking a tool call execution.
     */
    override async beforeToolCall(toolName: string, parameters: TToolParameters): Promise<void> {
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
     * Completes tracking for a tool call, recording duration, success, and
     * error details when {@link IExecutionAnalyticsOptions.trackErrors | trackErrors} is enabled.
     */
    override async afterToolCall(toolName: string, parameters: TToolParameters, result: IToolExecutionResult): Promise<void> {
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

        const errorInfo = result?.error && this.pluginOptions.trackErrors ? {
            message: String(result.error),
            // stack is optional in IExecutionStats interface
            type: 'ToolExecutionError'
        } : undefined;

        const stats: IExecutionStats = {
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
     * Records a failed execution for the first active tracking entry, logging
     * error details when error tracking is enabled.
     */
    override async onError(error: Error, context?: IPluginErrorContext): Promise<void> {
        // Find any active execution that might be related to this error
        const activeExecution = Array.from(this.activeExecutions.entries())[0];

        if (activeExecution) {
            const [executionId, executionData] = activeExecution;
            const endTime = Date.now();
            const duration = endTime - executionData.startTime;

            const errorInfo = this.pluginOptions.trackErrors ? {
                message: error.message,
                ...(error.stack && { stack: error.stack }),
                type: error.constructor.name
            } : undefined;

            const stats: IExecutionStats = {
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
     * Returns recorded execution entries, optionally filtered by operation
     * name and/or time range.
     */
    getExecutionStats(operation?: string, timeRange?: { start: Date; end: Date }): IExecutionStats[] {
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
     * Computes aggregated analytics (totals, averages, success rates, error
     * distribution) across all recorded executions within the optional time range.
     */
    getAggregatedStats(timeRange?: { start: Date; end: Date }): IAggregatedExecutionStats {
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
     * Returns a snapshot of executions that have started but not yet completed,
     * with their current elapsed duration.
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
     * Returns internal plugin health metrics including record counts, active
     * tracking entries, and approximate memory usage.
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
    getExecutionData(): IExecutionStats[] {
        return [...this.executionHistory];
    }

    /**
     * Get analytics statistics
     */
    getAnalyticsStats(): IAggregatedExecutionStats {
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
        category: PluginCategory;
        priority: number;
        subscribedEventsCount: number;
        hasEventEmitter: boolean;
    } {
        return {
            name: this.name,
            version: this.version,
            enabled: this.enabled,
            initialized: this.initialized,
            category: this.category,
            priority: this.priority,
            subscribedEventsCount: this.subscribedEvents.length,
            hasEventEmitter: !!this.eventEmitter
        };
    }

    /**
 * Get plugin statistics
 */
    override getStats(): IExecutionAnalyticsPluginStats {
        const oldest = this.executionHistory[0];
        const newest = this.executionHistory[this.executionHistory.length - 1];

        return {
            enabled: this.enabled,
            calls: this.executionHistory.length,
            errors: this.executionHistory.filter(e => !e.success).length,
            ...(newest?.endTime && { lastActivity: newest.endTime }),
            totalRecorded: this.executionHistory.length,
            activeExecutions: this.activeExecutions.size,
            memoryUsage: this.getMemoryUsage(),
            ...(oldest && { oldestRecord: oldest.startTime }),
            ...(newest && { newestRecord: newest.endTime })
        };
    }

    // Helper methods

    private recordStats(stats: IExecutionStats): void {
        this.executionHistory.push(stats);

        // Maintain max entries limit
        if (this.executionHistory.length > this.pluginOptions.maxEntries) {
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

    private findActiveExecution(operation: string, input?: string): { executionId: string; executionData: { startTime: number; operation: string; input?: string } } | undefined {
        for (const [executionId, executionData] of this.activeExecutions.entries()) {
            if (executionData.operation === operation) {
                // For 'run' operations, also match input if provided
                if (operation === 'run' && input && executionData.input !== input) {
                    continue;
                }
                return { executionId, executionData };
            }
        }
        return undefined;
    }

    /**
     * Get memory usage estimate
     */
    private getMemoryUsage(): number {
        return this.executionHistory.length + this.activeExecutions.size;
    }

    /**
     * Validate plugin options
     */
    private validateOptions(options: IExecutionAnalyticsOptions): void {
        if (options.maxEntries !== undefined && options.maxEntries < 1) {
            this.logger.warn('maxEntries must be at least 1. Setting to 1000.');
            this.pluginOptions.maxEntries = 1000;
        }
        if (options.performanceThreshold !== undefined && options.performanceThreshold < 0) {
            this.logger.warn('performanceThreshold cannot be negative. Setting to 5000.');
            this.pluginOptions.performanceThreshold = 5000;
        }
        if (options.trackErrors !== undefined && typeof options.trackErrors !== 'boolean') {
            this.logger.warn('trackErrors must be a boolean. Setting to true.');
            this.pluginOptions.trackErrors = true;
        }
        if (options.enableWarnings !== undefined && typeof options.enableWarnings !== 'boolean') {
            this.logger.warn('enableWarnings must be a boolean. Setting to true.');
            this.pluginOptions.enableWarnings = true;
        }
    }
} 