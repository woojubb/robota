import { executeBatch } from './tool-execution-batch';
import { TOOL_SEARCH_TOOL_NAME } from '../interfaces/tool-search';
import { ValidationError } from '../utils/errors';
import { SilentLogger, type ILogger } from '../utils/logger';

import type { IOwnerPathSegment, IToolEventData } from '../interfaces/event-service';
import type { IUserInteraction } from '../interfaces/interaction';
import type { IToolManager } from '../interfaces/manager';
import type { IToolExecutionRequest } from '../interfaces/service';
import type {
  IToolExecutionContext,
  IToolExecutionResult,
  TToolParameters,
  TToolMetadata,
} from '../interfaces/tool';
import type { IDeferredToolCatalog } from '../interfaces/tool-search';

export type { IToolExecutionBatchContext } from './tool-execution-batch-types';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';

export {
  TOOL_EVENTS,
  TOOL_EVENT_PREFIX,
  UNKNOWN_TOOL_ERROR_CODE,
  ARGUMENT_DECODE_ERROR_CODE,
} from './tool-execution-constants';
import { TOOL_EVENTS, UNKNOWN_TOOL_ERROR_CODE } from './tool-execution-constants';

/**
 * Simplified ToolExecutionService
 * Focuses only on core tool execution without complex hierarchy tracking
 */
export class ToolExecutionService {
  private tools: IToolManager;
  private logger: ILogger;
  private askHandler?: IUserInteraction['ask'];
  /** CLI-1990: the narrow port a search tool loads through — no tool ever holds the manager. */
  private readonly deferredToolCatalog: IDeferredToolCatalog;

  constructor(tools: IToolManager, logger: ILogger = SilentLogger) {
    this.tools = tools;
    this.logger = logger;
    this.deferredToolCatalog = {
      listDeferredTools: () => this.tools.listDeferredTools(),
      loadDeferredTools: (names) => this.tools.loadDeferredTools(names),
    };
  }

  /**
   * Session-scoped "ask the user" port (CMD-005). When set, every execution request built by
   * `createExecutionRequestsWithContext` carries it into the tool's `IToolExecutionContext.ask`.
   */
  setAskHandler(ask: IUserInteraction['ask'] | undefined): void {
    this.askHandler = ask;
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
    catalog: 'offered' | 'registered' = 'offered',
  ): Promise<IToolExecutionResult> {
    this.logger.debug(`Executing tool: ${toolName}`);

    try {
      if (!context?.executionId) {
        throw new ValidationError(
          'ToolExecutionService requires executionId (toolCallId) in ToolExecutionContext',
        );
      }

      // CLI-1990: a deferred tool the model has not loaded is refused like an unknown one — the model
      // was never shown its schema — and the remedy names the tool that loads it, so the two rounds
      // before the unknown-tool loop guard force-summarises are recoverable rather than fatal.
      context.signal?.throwIfAborted();
      const withheld =
        catalog === 'offered' &&
        this.tools.getToolSchema(toolName)?.deferLoading === true &&
        !this.tools.isToolOffered(toolName);
      if (!this.tools.hasTool(toolName) || withheld) {
        const availableTools = (
          catalog === 'registered' ? this.tools.getTools() : this.tools.getOfferedTools()
        )
          .map((tool) => tool.name)
          .sort();
        const error = formatUnknownToolError(toolName, availableTools, withheld);
        const eventService = context.eventService;
        if (eventService) {
          const errorEvent: IToolEventData = {
            timestamp: new Date(),
            toolName,
            error,
          };
          eventService.emit(TOOL_EVENTS.CALL_ERROR, errorEvent);
        }
        this.logger.warn('Tool call skipped because requested tool is not registered', {
          toolName,
          availableTools,
        });
        return {
          success: false,
          error,
          toolName,
          executionId: context.executionId,
          metadata: {
            errorCode: UNKNOWN_TOOL_ERROR_CODE,
            requestedTool: toolName,
            availableTools,
          },
        };
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
        deferredTools: this.deferredToolCatalog,
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
          result,
        };
        eventService.emit(TOOL_EVENTS.CALL_COMPLETE, completeEvent);
        eventService.emit(TOOL_EVENTS.CALL_RESPONSE_READY, completeEvent);
      }

      return {
        success: true,
        result,
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
      const decoded = decodeToolCallArguments(
        toolCall.id,
        toolCall.function.name,
        toolCall.function.arguments,
      );
      return {
        toolName: toolCall.function.name,
        // Issue #2875 (follow-up to #2078): a decode failure carries a placeholder here — the
        // batch executor checks `argumentDecodeError` and returns a failed result WITHOUT ever
        // passing `parameters` to the tool.
        parameters: decoded.ok ? decoded.parameters : ({} as TToolParameters),
        executionId: toolCall.id,
        ownerType: 'tool',
        ownerId: toolCall.id,
        ownerPath: [...context.ownerPathBase, { type: 'tool', id: toolCall.id }],
        metadata: context.metadataFactory ? context.metadataFactory(toolCall) : undefined,
        ...(this.askHandler ? { ask: this.askHandler } : {}),
        deferredTools: this.deferredToolCatalog,
        ...(decoded.ok ? {} : { argumentDecodeError: decoded.error }),
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

type TDecodedToolCallArguments =
  | { ok: true; parameters: TToolParameters }
  | { ok: false; error: string };

/**
 * Issue #2078: `TToolParameters` is a record contract, so a syntactically valid JSON body whose root
 * is `null`, a scalar, or an array is refused HERE. The parameter validator downstream enumerates
 * fields with `in` and assumes a non-null object; a bare cast would let those roots reach it.
 *
 * Issue #2875 (follow-up to #2078): this returns a result instead of throwing. One provider batch
 * can name several tool calls; a malformed call is THIS call's failure, not a reason to abort request
 * construction for the rest of the batch — the caller turns a decode failure into the same per-call
 * failed outcome an unknown tool name already gets, so every call still gets a result.
 */
function decodeToolCallArguments(
  callId: string,
  toolName: string,
  raw: string,
): TDecodedToolCallArguments {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: `Failed to parse arguments for tool "${toolName}" (call ${callId}): invalid JSON`,
    };
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    const root =
      decoded === null ? 'null' : Array.isArray(decoded) ? 'an array' : `a ${typeof decoded}`;
    return {
      ok: false,
      error: `Failed to parse arguments for tool "${toolName}" (call ${callId}): expected a JSON object at the root, got ${root}`,
    };
  }
  return { ok: true, parameters: decoded as TToolParameters };
}

function formatUnknownToolError(
  toolName: string,
  availableTools: string[],
  withheld: boolean,
): string {
  const available =
    availableTools.length > 0 ? availableTools.join(', ') : 'no registered tools are available';
  if (withheld) {
    return (
      `Tool "${toolName}" is registered but deferred and not yet loaded, so the tool call was not executed. ` +
      `Call ${TOOL_SEARCH_TOOL_NAME} with names: ["${toolName}"] to load it, then call it again. ` +
      `Available tools: ${available}.`
    );
  }
  return `Tool "${toolName}" is not registered, so the tool call was not executed. Available tools: ${available}.`;
}
