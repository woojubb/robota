import { ToolInterface, ToolExecutionResult, ToolResult } from '../interfaces/tool';
import { Tools } from '../managers/tool-manager';
import { Logger } from '../utils/logger';
import { ToolExecutionError, ValidationError } from '../utils/errors';

/**
 * Tool execution request
 */
export interface ToolExecutionRequest {
    /** Tool name to execute */
    toolName: string;
    /** Input parameters for the tool */
    parameters: Record<string, any>;
    /** Execution ID for tracking */
    executionId?: string;
    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
    /** Execution requests */
    requests: ToolExecutionRequest[];
    /** Execution mode */
    mode: 'parallel' | 'sequential';
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on error (sequential mode only) */
    continueOnError?: boolean;
    /** Maximum concurrent executions (parallel mode only) */
    maxConcurrency?: number;
}

/**
 * Tool execution summary
 */
export interface ToolExecutionSummary {
    /** Total number of tools executed */
    totalExecuted: number;
    /** Number of successful executions */
    successful: number;
    /** Number of failed executions */
    failed: number;
    /** Total execution time in milliseconds */
    totalDuration: number;
    /** Average execution time per tool */
    averageDuration: number;
    /** Execution results */
    results: ToolExecutionResult[];
    /** Errors that occurred */
    errors: Array<{
        toolName: string;
        error: Error;
        executionId?: string;
    }>;
}

/**
 * Tool execution statistics
 */
export interface ToolExecutionStats {
    /** Total tools executed */
    totalExecutions: number;
    /** Average execution time */
    averageExecutionTime: number;
    /** Success rate */
    successRate: number;
    /** Most used tools */
    mostUsedTools: Array<{ name: string; count: number }>;
    /** Error rate by tool */
    errorRates: Record<string, number>;
}

/**
 * Tool execution service options
 */
export interface ToolExecutionServiceOptions {
    /** Default execution timeout */
    defaultTimeout?: number;
    /** Default maximum concurrency */
    defaultMaxConcurrency?: number;
    /** Whether to collect execution statistics */
    collectStats?: boolean;
    /** Maximum number of execution history to keep */
    maxHistorySize?: number;
}

/**
 * Service for executing tools and managing tool execution workflows
 */
export class ToolExecutionService {
    private logger: Logger;
    private toolManager: Tools;
    private options: Required<ToolExecutionServiceOptions>;
    private executionHistory: ToolExecutionSummary[] = [];
    private executionStats: Map<string, { count: number; totalTime: number; errors: number }> = new Map();

    constructor(
        toolManager: Tools,
        options: ToolExecutionServiceOptions = {}
    ) {
        this.toolManager = toolManager;
        this.logger = new Logger('ToolExecutionService');
        this.options = {
            defaultTimeout: options.defaultTimeout || 120000, // Increased to 2 minutes for complex team tasks
            defaultMaxConcurrency: options.defaultMaxConcurrency || 5,
            collectStats: options.collectStats ?? true,
            maxHistorySize: options.maxHistorySize || 100,
        };

        this.logger.info('ToolExecutionService initialized', { options: this.options });
    }

    /**
     * Execute a single tool
     */
    async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
        const startTime = Date.now();
        const executionId = request.executionId || this.generateExecutionId();

        try {
            this.logger.debug('Starting tool execution', {
                toolName: request.toolName,
                executionId,
                parameters: request.parameters,
            });

            // Get tool from manager
            const tool = this.toolManager.getTool(request.toolName);
            if (!tool) {
                throw new ValidationError(`Tool "${request.toolName}" not found`);
            }

            // Validate parameters
            const validation = tool.validateParameters(request.parameters);
            if (!validation.isValid) {
                throw new ValidationError(
                    `Invalid parameters for tool "${request.toolName}": ${validation.errors.join(', ')}`
                );
            }

            // Execute tool with timeout
            const toolResult = await this.executeWithTimeout(
                () => tool.execute(request.parameters),
                this.options.defaultTimeout,
                `Tool execution for ${request.toolName}`
            ) as ToolResult;

            const duration = Date.now() - startTime;

            // Update statistics
            if (this.options.collectStats) {
                this.updateExecutionStats(request.toolName, duration, false);
            }

            this.logger.info('Tool executed successfully', {
                toolName: request.toolName,
                executionId,
                duration,
                success: toolResult.success,
            });

            const executionResult: ToolExecutionResult = {
                success: toolResult.success,
                toolName: request.toolName,
                result: typeof toolResult.data === 'string'
                    ? toolResult.data
                    : JSON.stringify(toolResult.data),
                error: toolResult.error,
                executionId,
                duration,
                metadata: {
                    ...toolResult.metadata,
                    ...request.metadata,
                },
            };

            return executionResult;
        } catch (error) {
            const duration = Date.now() - startTime;

            // Update error statistics
            if (this.options.collectStats) {
                this.updateExecutionStats(request.toolName, duration, true);
            }

            this.logger.error('Tool execution failed', {
                toolName: request.toolName,
                executionId,
                duration,
                error,
            });

            throw new ToolExecutionError(
                error instanceof Error ? error.message : String(error),
                request.toolName,
                error instanceof Error ? error : undefined,
                { executionId, duration }
            );
        }
    }

    /**
     * Execute multiple tools according to context
     */
    async executeTools(context: ToolExecutionContext): Promise<ToolExecutionSummary> {
        const startTime = Date.now();

        this.logger.info('Starting tool execution batch', {
            mode: context.mode,
            toolCount: context.requests.length,
            maxConcurrency: context.maxConcurrency,
        });

        let results: ToolExecutionResult[] = [];
        const errors: Array<{ toolName: string; error: Error; executionId?: string }> = [];

        try {
            if (context.mode === 'parallel') {
                const parallelResults = await this.executeToolsParallel(context);
                results = parallelResults.results;
                errors.push(...parallelResults.errors);
            } else {
                const sequentialResults = await this.executeToolsSequential(context);
                results = sequentialResults.results;
                errors.push(...sequentialResults.errors);
            }
        } catch (error) {
            this.logger.error('Tool execution batch failed', { error });
            throw error;
        }

        const totalDuration = Date.now() - startTime;
        const successful = results.filter(r => r.success).length;
        const failed = results.length - successful + errors.length;

        const summary: ToolExecutionSummary = {
            totalExecuted: context.requests.length,
            successful,
            failed,
            totalDuration,
            averageDuration: results.length > 0 ? totalDuration / results.length : 0,
            results,
            errors,
        };

        // Store execution history
        if (this.options.collectStats) {
            this.addToHistory(summary);
        }

        this.logger.info('Tool execution batch completed', {
            mode: context.mode,
            totalExecuted: summary.totalExecuted,
            successful: summary.successful,
            failed: summary.failed,
            totalDuration: summary.totalDuration,
        });

        return summary;
    }

    /**
     * Execute tools in parallel
     */
    private async executeToolsParallel(
        context: ToolExecutionContext
    ): Promise<{ results: ToolExecutionResult[]; errors: Array<{ toolName: string; error: Error; executionId?: string }> }> {
        const maxConcurrency = context.maxConcurrency || this.options.defaultMaxConcurrency;
        const results: ToolExecutionResult[] = [];
        const errors: Array<{ toolName: string; error: Error; executionId?: string }> = [];

        // Process requests in batches to respect concurrency limit
        for (let i = 0; i < context.requests.length; i += maxConcurrency) {
            const batch = context.requests.slice(i, i + maxConcurrency);

            const batchPromises = batch.map(async (request) => {
                try {
                    const result = await this.executeTool(request);
                    return { success: true, result };
                } catch (error) {
                    return {
                        success: false,
                        error: error as Error,
                        toolName: request.toolName,
                        executionId: request.executionId,
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);

            for (const batchResult of batchResults) {
                if (batchResult.success && batchResult.result) {
                    results.push(batchResult.result);
                } else if (!batchResult.success) {
                    errors.push({
                        toolName: batchResult.toolName!,
                        error: batchResult.error!,
                        executionId: batchResult.executionId,
                    });
                }
            }
        }

        return { results, errors };
    }

    /**
     * Execute tools sequentially
     */
    private async executeToolsSequential(
        context: ToolExecutionContext
    ): Promise<{ results: ToolExecutionResult[]; errors: Array<{ toolName: string; error: Error; executionId?: string }> }> {
        const results: ToolExecutionResult[] = [];
        const errors: Array<{ toolName: string; error: Error; executionId?: string }> = [];

        for (const request of context.requests) {
            try {
                const result = await this.executeTool(request);
                results.push(result);
            } catch (error) {
                errors.push({
                    toolName: request.toolName,
                    error: error as Error,
                    executionId: request.executionId,
                });

                // Stop execution if continueOnError is false
                if (!context.continueOnError) {
                    this.logger.warn('Stopping sequential execution due to error', {
                        toolName: request.toolName,
                        error,
                    });
                    break;
                }
            }
        }

        return { results, errors };
    }

    /**
     * Get execution statistics
     */
    getExecutionStats(): ToolExecutionStats {
        const totalExecutions = Array.from(this.executionStats.values())
            .reduce((sum, stats) => sum + stats.count, 0);

        const totalTime = Array.from(this.executionStats.values())
            .reduce((sum, stats) => sum + stats.totalTime, 0);

        const averageExecutionTime = totalExecutions > 0 ? totalTime / totalExecutions : 0;

        const totalErrors = Array.from(this.executionStats.values())
            .reduce((sum, stats) => sum + stats.errors, 0);

        const successRate = totalExecutions > 0 ?
            ((totalExecutions - totalErrors) / totalExecutions) * 100 : 100;

        const mostUsedTools = Array.from(this.executionStats.entries())
            .map(([name, stats]) => ({ name, count: stats.count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const errorRates: Record<string, number> = {};
        for (const [name, stats] of this.executionStats.entries()) {
            errorRates[name] = stats.count > 0 ? (stats.errors / stats.count) * 100 : 0;
        }

        return {
            totalExecutions,
            averageExecutionTime,
            successRate,
            mostUsedTools,
            errorRates,
        };
    }

    /**
     * Get execution history
     */
    getExecutionHistory(): ToolExecutionSummary[] {
        return [...this.executionHistory];
    }

    /**
     * Clear execution statistics and history
     */
    clearStats(): void {
        this.executionStats.clear();
        this.executionHistory = [];
        this.logger.info('Execution statistics and history cleared');
    }

    /**
     * Create tool execution requests from tool calls
     */
    createExecutionRequests(toolCalls: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
    }>): ToolExecutionRequest[] {
        return toolCalls.map(toolCall => {
            let parameters: Record<string, any> = {};
            try {
                parameters = JSON.parse(toolCall.function.arguments);
            } catch (error) {
                this.logger.warn('Failed to parse tool arguments', {
                    toolName: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                    error,
                });
            }

            return {
                toolName: toolCall.function.name,
                parameters,
                executionId: toolCall.id,
                metadata: {
                    toolCallType: toolCall.type,
                },
            };
        });
    }

    /**
     * Format execution results for AI response
     */
    formatResultsForResponse(summary: ToolExecutionSummary): string {
        const successfulResults = summary.results.filter(r => r.success);
        const failedResults = summary.results.filter(r => !r.success);

        let response = '';

        if (successfulResults.length > 0) {
            response += 'Successfully executed tools:\n';
            for (const result of successfulResults) {
                response += `- ${result.toolName}: ${result.result}\n`;
            }
        }

        if (failedResults.length > 0 || summary.errors.length > 0) {
            response += '\nTool execution errors:\n';
            for (const result of failedResults) {
                response += `- ${result.toolName}: ${result.error}\n`;
            }
            for (const error of summary.errors) {
                response += `- ${error.toolName}: ${error.error.message}\n`;
            }
        }

        return response.trim();
    }

    /**
     * Update execution statistics
     */
    private updateExecutionStats(toolName: string, duration: number, hasError: boolean): void {
        if (!this.executionStats.has(toolName)) {
            this.executionStats.set(toolName, { count: 0, totalTime: 0, errors: 0 });
        }

        const stats = this.executionStats.get(toolName)!;
        stats.count++;
        stats.totalTime += duration;
        if (hasError) {
            stats.errors++;
        }
    }

    /**
     * Add execution summary to history
     */
    private addToHistory(summary: ToolExecutionSummary): void {
        this.executionHistory.push(summary);

        // Keep history size within limit
        if (this.executionHistory.length > this.options.maxHistorySize) {
            this.executionHistory.shift();
        }
    }

    /**
     * Execute function with timeout
     */
    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
        operation: string
    ): Promise<T> {
        return Promise.race([
            fn(),
            new Promise<never>((_, reject) => {
                setTimeout(
                    () => reject(new ToolExecutionError(`${operation} timed out after ${timeoutMs}ms`, operation)),
                    timeoutMs
                );
            }),
        ]);
    }

    /**
     * Generate unique execution ID
     */
    private generateExecutionId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `exec_${timestamp}_${random}`;
    }
} 