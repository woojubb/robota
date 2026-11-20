import { executeBatch } from './tool-execution-batch';
import { TOOL_SEARCH_TOOL_NAME } from '../interfaces/tool-search';
import { ValidationError } from '../utils/errors';
import { isExecutionControlError } from '../utils/execution-control-error';
import { ExecutionRecoveryError } from '../utils/execution-recovery-error';
import { isSnapshotableUniversalValue } from '../utils/universal-value-equal';
import { SilentLogger, type ILogger } from '../utils/logger';
import { snapshotToolProvenance, withToolProvenance } from '../utils/tool-provenance';

import type { IOwnerPathSegment, IToolEventData } from '../interfaces/event-service';
import type { IUserInteraction } from '../interfaces/interaction';
import type { IToolManager } from '../interfaces/manager';
import type { IToolExecutionRequest } from '../interfaces/service';
import type {
  IToolExecutionContext,
  IToolExecutionResult,
  IToolProvenance,
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
import {
  TOOL_EVENTS,
  UNKNOWN_TOOL_ERROR_CODE,
  ARGUMENT_DECODE_ERROR_CODE,
  TOOL_CALL_SKIPPED_ERROR_CODE,
} from './tool-execution-constants';

/**
 * Simplified ToolExecutionService
 * Focuses only on core tool execution without complex hierarchy tracking
 */
export class ToolExecutionService {
  private tools: IToolManager;
  private logger: ILogger;
  private askHandler?: IUserInteraction['ask'];
  /** The narrow port a search tool loads through — no tool ever holds the manager. */
  private readonly deferredToolCatalog: IDeferredToolCatalog;

  constructor(tools: IToolManager, logger: ILogger = SilentLogger) {
    this.tools = tools;
    this.logger = logger;
    this.deferredToolCatalog = {
      listDeferredTools: () => this.tools.listDeferredTools(),
      loadDeferredTools: (names) => this.tools.loadDeferredTools(names),
    };
  }

  getLoadedDeferredTools(): string[] | undefined {
    return this.tools.getLoadedDeferredTools?.();
  }

  restoreLoadedDeferredTools(names: readonly string[]): void {
    this.tools.loadDeferredTools(this.restorableDeferredTools(names));
  }

  withRestoredDeferredTools<T>(names: readonly string[], inspect: () => T): T {
    const visible = this.restorableDeferredTools(names);
    if (this.tools.withTemporaryLoadedDeferredTools)
      return this.tools.withTemporaryLoadedDeferredTools(visible, inspect);
    const loaded = new Set(this.tools.getLoadedDeferredTools?.() ?? []);
    if (loaded.size === new Set(visible).size && visible.every((name) => loaded.has(name)))
      return inspect();
    throw new ExecutionRecoveryError(
      'EXECUTION_RECOVERY_INVALID',
      'Tool manager cannot inspect restored residency without changing live state',
    );
  }

  private restorableDeferredTools(names: readonly string[]): string[] {
    for (const name of names) {
      if (!this.tools.hasTool(name))
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          `Recovery tool is no longer registered: ${name}`,
        );
    }
    const visible = new Set(this.tools.getTools().map((tool) => tool.name));
    return names.filter((name) => visible.has(name));
  }

  /**
   * Session-scoped "ask the user" port. When set, every execution request built by
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
    let provenance: IToolProvenance | undefined;

    try {
      if (!context?.executionId) {
        throw new ValidationError(
          'ToolExecutionService requires executionId (toolCallId) in ToolExecutionContext',
        );
      }

      // A deferred tool the model has not loaded is refused like an unknown one — the model
      // was never shown its schema — and the remedy names the tool that loads it, so the two rounds
      // before the unknown-tool loop guard force-summarises are recoverable rather than fatal.
      provenance = snapshotToolProvenance(this.tools.getTool?.(toolName)?.provenance);
      context.signal?.throwIfAborted();
      // A registered tool the model is not offered is one of two things: a deferred tool it has not
      // loaded (visible, so a search can load it), or one the session hides outright — denied, or
      // outside its allowed set. The model was never shown the second, so a call to it is answered
      // as not allowed rather than reaching the permission gate, whose refusal reads as the person
      // having said no.
      const notOffered =
        catalog === 'offered' &&
        this.tools.hasTool(toolName) &&
        !this.tools.isToolOffered(toolName);
      const withheld =
        notOffered &&
        this.tools.getToolSchema(toolName)?.deferLoading === true &&
        this.tools.getTools().some((tool) => tool.name === toolName);
      const hidden = notOffered && !withheld;
      if (!this.tools.hasTool(toolName) || withheld || hidden) {
        const availableTools = (
          catalog === 'registered' ? this.tools.getTools() : this.tools.getOfferedTools()
        )
          .map((tool) => tool.name)
          .sort();
        const error = formatUnknownToolError(
          toolName,
          availableTools,
          hidden ? 'hidden' : withheld ? 'deferred' : 'unknown',
        );
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
      if (context.beforeToolEffect && !isSnapshotableUniversalValue(parameters))
        throw new ExecutionRecoveryError(
          'EXECUTION_RECOVERY_INVALID',
          'Tool parameters cannot be represented for effect admission',
        );
      if (eventService) {
        const startEvent: IToolEventData = {
          timestamp: new Date(),
          toolName,
          parameters: context.beforeToolEffect ? structuredClone(parameters) : parameters,
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
      const rawEnvelope = this.tools.executeToolResult
        ? await this.tools.executeToolResult(toolName, parameters, executionContext)
        : {
            success: true,
            data: await this.tools.executeTool(toolName, parameters, executionContext),
          };
      // Only the host can classify a call as unknown, undecodable, or skipped. A tool's
      // own metadata cannot turn an entered body into one of those pre-dispatch outcomes.
      let ownedEnvelope = rawEnvelope;
      if (context.beforeToolEffect) {
        try {
          const { success, data, parts, error, metadata } = rawEnvelope;
          ownedEnvelope = structuredClone({ success, data, parts, error, metadata });
        } catch {
          throw new ExecutionRecoveryError(
            'EXECUTION_RECOVERY_REQUIRED',
            'Tool result cannot be safely settled after the effect',
          );
        }
      }
      const metadata = ownedEnvelope.metadata;
      const reserved =
        metadata?.errorCode === UNKNOWN_TOOL_ERROR_CODE ||
        metadata?.errorCode === ARGUMENT_DECODE_ERROR_CODE ||
        metadata?.errorCode === TOOL_CALL_SKIPPED_ERROR_CODE;
      let safeEnvelope = ownedEnvelope;
      if (metadata && (reserved || metadata.dispatchStatus !== undefined)) {
        const { errorCode, dispatchStatus: _dispatchStatus, ...rest } = metadata;
        void _dispatchStatus;
        safeEnvelope = {
          ...ownedEnvelope,
          metadata: { ...rest, ...(!reserved && errorCode !== undefined && { errorCode }) },
        };
      }
      const envelope = withToolProvenance(safeEnvelope, provenance);
      if (!envelope.success) {
        const error = envelope.error || 'Tool execution failed';
        eventService?.emit(TOOL_EVENTS.CALL_ERROR, { timestamp: new Date(), toolName, error });
        return {
          success: false,
          error,
          result: envelope.data,
          parts: envelope.parts,
          metadata: envelope.metadata,
          toolName,
          executionId: executionContext.executionId,
        };
      }
      if (envelope.data === undefined)
        throw new Error('Tool execution succeeded but returned no data');
      const result = envelope.data;

      this.logger.debug(`Tool execution completed: ${toolName}`);

      if (eventService) {
        const completeEvent: IToolEventData = {
          timestamp: new Date(),
          toolName,
          result: context.beforeToolEffect ? structuredClone(result) : result,
        };
        eventService.emit(TOOL_EVENTS.CALL_COMPLETE, completeEvent);
        eventService.emit(TOOL_EVENTS.CALL_RESPONSE_READY, completeEvent);
      }

      return {
        success: true,
        result,
        ...(envelope.parts ? { parts: envelope.parts } : {}),
        ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
        toolName,
        executionId: executionContext.executionId!,
      };
    } catch (error) {
      if (isExecutionControlError(error)) throw error;
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

      const observation = withToolProvenance(
        { success: false, error: toolError.message },
        provenance,
      );
      return {
        success: false,
        error: toolError.message,
        ...(observation.parts ? { parts: observation.parts } : {}),
        ...(observation.metadata ? { metadata: observation.metadata } : {}),
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
        // A decode failure carries a placeholder here — the
        // batch executor checks `argumentDecodeError` and returns a failed result WITHOUT ever
        // passing `parameters` to the tool.
        parameters: decoded.ok ? decoded.parameters : ({} as TToolParameters),
        executionId: toolCall.id,
        ownerType: 'tool',
        ownerId: toolCall.id,
        ownerPath: [...context.ownerPathBase, { type: 'tool', id: toolCall.id }],
        metadata: withToolProvenance(
          { success: true, metadata: context.metadataFactory?.(toolCall) },
          snapshotToolProvenance(this.tools.getTool?.(toolCall.function.name)?.provenance),
        ).metadata,
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
  { ok: true; parameters: TToolParameters } | { ok: false; error: string };

/**
 * `TToolParameters` is a record contract, so a syntactically valid JSON body whose root
 * is `null`, a scalar, or an array is refused HERE. The parameter validator downstream enumerates
 * fields with `in` and assumes a non-null object; a bare cast would let those roots reach it.
 *
 * This returns a result instead of throwing. One provider batch
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
  kind: 'unknown' | 'deferred' | 'hidden',
): string {
  const available =
    availableTools.length > 0 ? availableTools.join(', ') : 'no registered tools are available';
  if (kind === 'hidden') {
    return `Tool "${toolName}" is not allowed in this session, so the tool call was not executed. Available tools: ${available}.`;
  }
  if (kind === 'deferred') {
    return (
      `Tool "${toolName}" is registered but deferred and not yet loaded, so the tool call was not executed. ` +
      `Call ${TOOL_SEARCH_TOOL_NAME} with names: ["${toolName}"] to load it, then call it again. ` +
      `Available tools: ${available}.`
    );
  }
  return `Tool "${toolName}" is not registered, so the tool call was not executed. Available tools: ${available}.`;
}
