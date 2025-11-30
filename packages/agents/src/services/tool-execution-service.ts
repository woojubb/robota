import { ToolExecutionResult, ToolResult, ToolExecutionContext, ToolOwnerPathSegment, ToolMetadata } from '../interfaces/tool';
import type { ToolManagerInterface } from '../interfaces/manager';
import type { ToolParameters } from '../interfaces/tool';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';
import { ToolExecutionError, ValidationError } from '../utils/errors';

// Add missing types for ExecutionService compatibility
export interface ToolExecutionRequest {
    toolName: string;
    parameters: ToolParameters;
    executionId?: string;
    metadata?: ToolMetadata;
    ownerType?: string;
    ownerId?: string;
    ownerPath?: ToolOwnerPathSegment[];
    sourceId?: string;
}

export interface ToolExecutionBatchContext {
    requests: ToolExecutionRequest[];
    mode: 'parallel' | 'sequential';
    timeout?: number;
    continueOnError?: boolean;
    maxConcurrency?: number;
    parentContext?: ToolExecutionContext;
}

/**
 * Simplified ToolExecutionService
 * Focuses only on core tool execution without complex hierarchy tracking
 */
export class ToolExecutionService {
    private tools: ToolManagerInterface;
    private logger: SimpleLogger;

    constructor(tools: ToolManagerInterface, logger?: SimpleLogger) {
        this.tools = tools;
        this.logger = logger || SilentLogger;
    }

    /**
     * Execute a single tool
     * @param toolName - Name of the tool to execute
     * @param parameters - Tool parameters
     * @param context - Optional execution context
     * @returns Promise resolving to tool execution result
     */
    async executeTool(
        toolName: string,
        parameters: ToolParameters,
        context?: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
        this.logger.debug(`Executing tool: ${toolName}`);

        try {
            // Create execution context if not provided
            const executionContext: ToolExecutionContext = {
                toolName,
                parameters,
                executionId: context?.executionId || `${toolName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                ownerType: context?.ownerType || 'tool',
                ownerId: context?.ownerId || context?.executionId,
                ownerPath: context?.ownerPath,
                sourceId: context?.sourceId || context?.executionId,
                ...context
            };

            // Tool Execution Context validation for assignTask
            if (toolName === 'assignTask') {
                this.logger.info(`[ToolExecutionService] Executing assignTask with context`, {
                    hasContext: !!context,
                    executionId: executionContext.executionId,
                    ownerPathLength: executionContext.ownerPath?.length || 0,
                    ownerPath: executionContext.ownerPath
                });
            }

            // Execute the tool with full context
            // Context already contains all necessary information including tool call ID
            const result = await this.tools.executeTool(toolName, parameters as any, executionContext);

            this.logger.debug(`Tool execution completed: ${toolName}`);

            return {
                success: true,
                result: result,
                toolName,
                executionId: executionContext.executionId!
            };
        } catch (error) {
            this.logger.error(`Tool execution failed: ${toolName}`);

            const toolError = error instanceof Error ? error : new Error(String(error));

            return {
                success: false,
                error: toolError.message,
                toolName,
                executionId: context?.executionId || `${toolName}-error-${Date.now()}`
            };
        }
    }

    /**
     * Create execution requests with context (for ExecutionService compatibility)
     * @param toolCalls - Array of tool calls from AI provider
     * @param context - Execution context
     * @returns Array of tool execution requests
     */
    createExecutionRequestsWithContext(
        toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
        context: {
            ownerPathBase: ToolOwnerPathSegment[];
            metadataFactory?: (toolCall: { id: string; function: { name: string; arguments: string } }) => ToolMetadata | undefined;
        }
    ): ToolExecutionRequest[] {
        return toolCalls.map(toolCall => ({
            toolName: toolCall.function.name,
            parameters: JSON.parse(toolCall.function.arguments),
            executionId: toolCall.id,
            ownerType: 'tool',
            ownerId: toolCall.id,
            sourceId: toolCall.id,
            ownerPath: [...context.ownerPathBase, { type: 'tool', id: toolCall.id }],
            metadata: context.metadataFactory ? context.metadataFactory(toolCall) : undefined
        }));
    }

    /**
     * Execute tools from batch context (for ExecutionService compatibility)
     * @param batchContext - Batch execution context
     * @returns Promise resolving to tool execution summary
     */
    async executeTools(batchContext: ToolExecutionBatchContext): Promise<{ results: ToolExecutionResult[], errors: Error[] }> {
        this.logger.debug(`Executing ${batchContext.requests.length} tools in ${batchContext.mode} mode`);

        const results: ToolExecutionResult[] = [];
        const errors: Error[] = [];

        if (batchContext.mode === 'parallel') {
            const promises = batchContext.requests.map(request =>
                this.executeTool(request.toolName, request.parameters, {
                    toolName: request.toolName,
                    parameters: request.parameters,
                    executionId: request.executionId,
                    ownerType: request.ownerType || 'tool',
                    ownerId: request.ownerId || request.executionId,
                    ownerPath: request.ownerPath,
                    sourceId: request.sourceId || request.executionId,
                    metadata: request.metadata
                }).catch(error => ({
                    toolName: request.toolName || 'unknown',
                    result: null,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    executionId: request.executionId || 'unknown'
                }))
            );
            const allResults = await Promise.all(promises);

            // Separate successful results from errors
            allResults.forEach(result => {
                if (result.success) {
                    results.push(result);
                } else {
                    errors.push({
                        executionId: result.executionId,
                        error: new Error(result.error || 'Unknown error'),
                        toolName: result.toolName
                    } as any);
                }
            });
        } else {
            // Sequential execution
            for (const request of batchContext.requests) {
                try {
                    const result = await this.executeTool(request.toolName, request.parameters, {
                        toolName: request.toolName,
                        parameters: request.parameters,
                        executionId: request.executionId,
                        ownerType: request.ownerType || 'tool',
                        ownerId: request.ownerId || request.executionId,
                        ownerPath: request.ownerPath,
                        sourceId: request.sourceId || request.executionId,
                        metadata: request.metadata
                    });
                    results.push(result);

                    if (!result.success && !batchContext.continueOnError) {
                        break;
                    }
                } catch (error) {
                    errors.push({
                        executionId: request.executionId,
                        error: error instanceof Error ? error : new Error(String(error)),
                        toolName: request.toolName
                    } as any);

                    if (!batchContext.continueOnError) {
                        break;
                    }
                }
            }
        }

        return { results, errors };
    }
}