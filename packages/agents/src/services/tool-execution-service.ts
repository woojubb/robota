import { IToolExecutionResult, IToolExecutionContext } from '../interfaces/tool';
import type { IToolManager } from '../interfaces/manager';
import type { TToolParameters, TToolMetadata } from '../interfaces/tool';
import type { IOwnerPathSegment, IToolEventData } from '../interfaces/event-service';
import type { IToolExecutionRequest } from '../interfaces/service';
import { SilentLogger, type ILogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

/**
 * ToolExecutionService owned events
 * Local event names only (no dots). Full names are composed at emit time.
 */
export const TOOL_EVENTS = {
    CALL_START: 'call_start',
    CALL_COMPLETE: 'call_complete',
    CALL_ERROR: 'call_error',
    CALL_RESPONSE_READY: 'call_response_ready'
} as const;

export const TOOL_EVENT_PREFIX = 'tool' as const;

export interface IToolExecutionBatchContext {
    requests: IToolExecutionRequest[];
    mode: 'parallel' | 'sequential';
    timeout?: number;
    continueOnError?: boolean;
    maxConcurrency?: number;
    parentContext?: IToolExecutionContext;
}

interface IRequiredToolExecutionRequestFields {
    executionId: string;
    ownerType: string;
    ownerId: string;
}

/**
 * Simplified ToolExecutionService
 * Focuses only on core tool execution without complex hierarchy tracking
 */
export class ToolExecutionService {
    private tools: IToolManager;
    private logger: ILogger;

    constructor(tools: IToolManager, logger: ILogger = SilentLogger) {
        this.tools = tools;
        this.logger = logger;
    }

    private requireExecutionRequestFields(request: IToolExecutionRequest): IRequiredToolExecutionRequestFields {
        if (!request.executionId) {
            throw new ValidationError('[STRICT-POLICY][EMITTER-CONTRACT] Tool execution request missing executionId');
        }
        if (!request.ownerType) {
            throw new ValidationError(
                `[STRICT-POLICY][EMITTER-CONTRACT] Tool execution request missing ownerType: executionId=${request.executionId}`
            );
        }
        if (!request.ownerId) {
            throw new ValidationError(
                `[STRICT-POLICY][EMITTER-CONTRACT] Tool execution request missing ownerId: executionId=${request.executionId}`
            );
        }
        return {
            executionId: request.executionId,
            ownerType: request.ownerType,
            ownerId: request.ownerId
        };
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
        parameters: TToolParameters,
        context?: IToolExecutionContext
    ): Promise<IToolExecutionResult> {
        this.logger.debug(`Executing tool: ${toolName}`);

        try {
            if (!context?.executionId) {
                throw new ValidationError('ToolExecutionService requires executionId (toolCallId) in ToolExecutionContext');
            }

            const eventService = context.eventService;
            if (eventService) {
                const startEvent: IToolEventData = {
                    timestamp: new Date(),
                    toolName,
                    parameters
                };
                eventService.emit(TOOL_EVENTS.CALL_START, startEvent);
            }

            // Normalize execution context without duplicating keys from the spread.
            const {
                toolName: _toolName,
                parameters: _parameters,
                ...restContext
            } = context;
            void _toolName;
            void _parameters;

            const executionContext: IToolExecutionContext = {
                ...restContext,
                toolName,
                parameters,
                executionId: context.executionId
            };

            // Execute the tool with full context
            // Context already contains all necessary information including tool call ID
            const result = await this.tools.executeTool(toolName, parameters, executionContext);

            this.logger.debug(`Tool execution completed: ${toolName}`);

            if (eventService) {
                const completeEvent: IToolEventData = {
                    timestamp: new Date(),
                    toolName,
                    result: result
                };
                eventService.emit(TOOL_EVENTS.CALL_COMPLETE, completeEvent);
                eventService.emit(TOOL_EVENTS.CALL_RESPONSE_READY, completeEvent);
            }

            return {
                success: true,
                result: result,
                toolName,
                executionId: executionContext.executionId!
            };
        } catch (error) {
            this.logger.error(`Tool execution failed: ${toolName}`);

            const toolError = error instanceof Error ? error : new Error(String(error));

            const eventService = context?.eventService;
            if (eventService && context?.executionId) {
                const errorEvent: IToolEventData = {
                    timestamp: new Date(),
                    toolName,
                    error: toolError.message
                };
                eventService.emit(TOOL_EVENTS.CALL_ERROR, errorEvent);
            }

            return {
                success: false,
                error: toolError.message,
                toolName,
                executionId: context?.executionId
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
            ownerPathBase: IOwnerPathSegment[];
            metadataFactory?: (toolCall: { id: string; function: { name: string; arguments: string } }) => TToolMetadata | undefined;
        }
    ): IToolExecutionRequest[] {
        return toolCalls.map(toolCall => {
            let parsedParameters: TToolParameters;
            try {
                parsedParameters = JSON.parse(toolCall.function.arguments) as TToolParameters;
            } catch {
                throw new ValidationError(
                    `Failed to parse arguments for tool "${toolCall.function.name}" (call ${toolCall.id}): invalid JSON`
                );
            }
            return {
            toolName: toolCall.function.name,
            parameters: parsedParameters,
            executionId: toolCall.id,
            ownerType: 'tool',
            ownerId: toolCall.id,
            ownerPath: [...context.ownerPathBase, { type: 'tool', id: toolCall.id }],
            metadata: context.metadataFactory ? context.metadataFactory(toolCall) : undefined
            };
        });
    }

    /**
     * Execute tools from batch context (for ExecutionService compatibility)
     * @param batchContext - Batch execution context
     * @returns Promise resolving to tool execution summary
     */
    async executeTools(batchContext: IToolExecutionBatchContext): Promise<{ results: IToolExecutionResult[], errors: Error[] }> {
        this.logger.debug(`Executing ${batchContext.requests.length} tools in ${batchContext.mode} mode`);

        const results: IToolExecutionResult[] = [];
        const errors: Error[] = [];

        if (batchContext.mode === 'parallel') {
            const promises = batchContext.requests.map(request =>
                (() => {
                    const required = this.requireExecutionRequestFields(request);
                    return this.executeTool(request.toolName, request.parameters, {
                    toolName: request.toolName,
                    parameters: request.parameters,
                    executionId: required.executionId,
                    ownerType: required.ownerType,
                    ownerId: required.ownerId,
                    ownerPath: request.ownerPath,
                    metadata: request.metadata,
                    eventService: request.eventService,
                    baseEventService: request.baseEventService
                    });
                })()
            );
            const allResults = await Promise.allSettled(promises);

            // Preserve a result entry for every request (SSOT for toolCallId → result mapping).
            // ExecutionService depends on `executionId` to add tool messages in the original call order.
            allResults.forEach((settledResult, index) => {
                const request = batchContext.requests[index];
                if (!request) {
                    return;
                }
                if (settledResult.status === 'fulfilled') {
                    const result = settledResult.value;
                    results.push(result);
                    if (!result.success) {
                        const err = new Error(
                            `Tool execution failed: toolName=${String(result.toolName)} executionId=${String(result.executionId)} error=${String(result.error || 'Unknown error')}`
                        );
                        errors.push(err);
                    }
                    return;
                }
                const err = settledResult.reason instanceof Error
                    ? settledResult.reason
                    : new Error(String(settledResult.reason));
                errors.push(err);
                results.push({
                    toolName: request.toolName,
                    result: null,
                    success: false,
                    error: err.message,
                    executionId: request.executionId
                });
            });
            if (errors.length > 0 && !batchContext.continueOnError) {
                throw errors[0];
            }
        } else {
            // Sequential execution
            for (const request of batchContext.requests) {
                try {
                    const required = this.requireExecutionRequestFields(request);
                    const result = await this.executeTool(request.toolName, request.parameters, {
                        toolName: request.toolName,
                        parameters: request.parameters,
                        executionId: required.executionId,
                        ownerType: required.ownerType,
                        ownerId: required.ownerId,
                        ownerPath: request.ownerPath,
                        metadata: request.metadata,
                        eventService: request.eventService,
                        baseEventService: request.baseEventService
                    });
                    results.push(result);
                    if (!result.success) {
                        errors.push(
                            new Error(
                                `Tool execution failed: toolName=${String(result.toolName)} executionId=${String(result.executionId)} error=${String(result.error || 'Unknown error')}`
                            )
                        );
                    }

                    if (!result.success && !batchContext.continueOnError) {
                        break;
                    }
                } catch (error) {
                    const err = error instanceof Error
                        ? error
                        : new Error(String(error));
                    errors.push(err);

                    if (!batchContext.continueOnError) {
                        break;
                    }
                }
            }
        }

        return { results, errors };
    }
}