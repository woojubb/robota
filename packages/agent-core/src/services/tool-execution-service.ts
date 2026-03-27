import { IToolExecutionResult, IToolExecutionContext } from '../interfaces/tool';
import type { IToolManager } from '../interfaces/manager';
import type { TToolParameters, TToolMetadata } from '../interfaces/tool';
import type { IOwnerPathSegment, IToolEventData } from '../interfaces/event-service';
import type { IToolExecutionRequest } from '../interfaces/service';
import { SilentLogger, type ILogger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { executeBatch } from './tool-execution-batch';

/**
 * ToolExecutionService owned events
 * Local event names only (no dots). Full names are composed at emit time.
 */
export const TOOL_EVENTS = {
  CALL_START: 'call_start',
  CALL_COMPLETE: 'call_complete',
  CALL_ERROR: 'call_error',
  CALL_RESPONSE_READY: 'call_response_ready',
} as const;

export const TOOL_EVENT_PREFIX = 'tool' as const;

export interface IToolExecutionBatchContext {
  requests: IToolExecutionRequest[];
  mode: 'parallel' | 'sequential';
  timeout?: number;
  continueOnError?: boolean;
  maxConcurrency?: number;
  parentContext?: IToolExecutionContext;
  /** AbortSignal — queued tools are skipped when aborted */
  signal?: AbortSignal;
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
    context?: IToolExecutionContext,
  ): Promise<IToolExecutionResult> {
    this.logger.debug(`Executing tool: ${toolName}`);

    try {
      if (!context?.executionId) {
        throw new ValidationError(
          'ToolExecutionService requires executionId (toolCallId) in ToolExecutionContext',
        );
      }

      const eventService = context.eventService;
      if (eventService) {
        const startEvent: IToolEventData = {
          timestamp: new Date(),
          toolName,
          parameters,
        };
        eventService.emit(TOOL_EVENTS.CALL_START, startEvent);
      }

      // Normalize execution context without duplicating keys from the spread.
      const { toolName: _toolName, parameters: _parameters, ...restContext } = context;
      void _toolName;
      void _parameters;

      const executionContext: IToolExecutionContext = {
        ...restContext,
        toolName,
        parameters,
        executionId: context.executionId,
      };

      // Execute the tool with full context
      // Context already contains all necessary information including tool call ID
      const result = await this.tools.executeTool(toolName, parameters, executionContext);

      this.logger.debug(`Tool execution completed: ${toolName}`);

      if (eventService) {
        const completeEvent: IToolEventData = {
          timestamp: new Date(),
          toolName,
          result: result,
        };
        eventService.emit(TOOL_EVENTS.CALL_COMPLETE, completeEvent);
        eventService.emit(TOOL_EVENTS.CALL_RESPONSE_READY, completeEvent);
      }

      return {
        success: true,
        result: result,
        toolName,
        executionId: executionContext.executionId!,
      };
    } catch (error) {
      this.logger.error(`Tool execution failed: ${toolName}`);

      const toolError = error instanceof Error ? error : new Error(String(error));

      const eventService = context?.eventService;
      if (eventService && context?.executionId) {
        const errorEvent: IToolEventData = {
          timestamp: new Date(),
          toolName,
          error: toolError.message,
        };
        eventService.emit(TOOL_EVENTS.CALL_ERROR, errorEvent);
      }

      return {
        success: false,
        error: toolError.message,
        toolName,
        executionId: context?.executionId,
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
      metadataFactory?: (toolCall: {
        id: string;
        function: { name: string; arguments: string };
      }) => TToolMetadata | undefined;
    },
  ): IToolExecutionRequest[] {
    return toolCalls.map((toolCall) => {
      let parsedParameters: TToolParameters;
      try {
        parsedParameters = JSON.parse(toolCall.function.arguments) as TToolParameters;
      } catch {
        throw new ValidationError(
          `Failed to parse arguments for tool "${toolCall.function.name}" (call ${toolCall.id}): invalid JSON`,
        );
      }
      return {
        toolName: toolCall.function.name,
        parameters: parsedParameters,
        executionId: toolCall.id,
        ownerType: 'tool',
        ownerId: toolCall.id,
        ownerPath: [...context.ownerPathBase, { type: 'tool', id: toolCall.id }],
        metadata: context.metadataFactory ? context.metadataFactory(toolCall) : undefined,
      };
    });
  }

  /**
   * Execute tools from batch context (for ExecutionService compatibility)
   * @param batchContext - Batch execution context
   * @returns Promise resolving to tool execution summary
   */
  async executeTools(
    batchContext: IToolExecutionBatchContext,
  ): Promise<{ results: IToolExecutionResult[]; errors: Error[] }> {
    return executeBatch(batchContext, this, this.logger);
  }
}
