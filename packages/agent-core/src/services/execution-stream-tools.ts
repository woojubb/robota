import type { IToolCall } from '../interfaces/messages';
import type { IToolExecutionBatchContext, ToolExecutionService } from './tool-execution-service';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { ILogger } from '../utils/logger';
import { isExecutionError } from './execution-types';
import type { IExecutionError } from './execution-types';
import { EXECUTION_EVENTS } from './execution-constants';
import type { IStreamChunk } from './execution-stream';

/**
 * Execute tool calls detected during streaming and yield result chunks.
 * Extracted from execution-stream.ts to reduce file size.
 */
export async function* executeStreamToolCalls(
  toolCalls: IToolCall[],
  conversationStore: {
    addToolMessageWithId: (
      content: string,
      toolCallId: string,
      toolName: string,
      metadata?: Record<string, string | number | boolean>,
    ) => void;
  },
  streamingConversationId: string,
  executionId: string,
  toolExecutionService: ToolExecutionService,
  eventEmitter: ExecutionEventEmitter,
  logger: ILogger,
): AsyncGenerator<IStreamChunk> {
  logger.debug('[EXECUTION-SERVICE-STREAM] Executing tools:', {
    tools: toolCalls.map((tc) => tc.function.name),
  });

  const streamingRootId = streamingConversationId;
  const streamingThinkingNodeId = `thinking_${streamingRootId}_${Date.now()}_${executionId}`;
  const streamingOwnerPathBase = [
    ...eventEmitter.buildExecutionOwnerContext(streamingRootId, executionId).ownerPath,
    { type: 'thinking', id: streamingThinkingNodeId },
  ];
  const toolRequests = toolExecutionService.createExecutionRequestsWithContext(toolCalls, {
    ownerPathBase: streamingOwnerPathBase,
  });
  const toolContext: IToolExecutionBatchContext = {
    requests: toolRequests,
    mode: 'parallel',
    maxConcurrency: 5,
    continueOnError: true,
  };

  const toolSummary = await toolExecutionService.executeTools(toolContext);

  for (const toolCall of toolCalls) {
    if (!toolCall.id) {
      throw new Error('[EXECUTION] Tool call missing id in streaming mode');
    }
    if (!toolCall.function?.name || toolCall.function.name.length === 0) {
      throw new Error(
        `[EXECUTION] Tool call "${toolCall.id}" missing function name in streaming mode`,
      );
    }

    const result = toolSummary.results.find((r) => r.executionId === toolCall.id);
    const error = toolSummary.errors.find(
      (e) => isExecutionError(e) && e.executionId === toolCall.id,
    );

    let content: string;
    let metadata: Record<string, string | number | boolean> = {
      executionId,
    };

    if (result && result.success) {
      if (typeof result.result === 'undefined') {
        throw new Error('[EXECUTION] Tool result missing result payload in streaming mode');
      }
      content = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      metadata['success'] = true;
      if (result.toolName) {
        metadata['toolName'] = result.toolName;
      }

      yield {
        chunk: `\n[Tool: ${toolCall.function.name} executed successfully]`,
        isComplete: false,
      };
    } else if (error) {
      const execError = error as IExecutionError;
      const execMessage = (() => {
        if (execError.error?.message) return execError.error.message;
        if (execError.message) return execError.message;
        return '';
      })();
      if (!execMessage || execMessage.length === 0) {
        throw new Error('[EXECUTION] Tool execution error missing message in streaming mode');
      }
      content = `Error: ${execMessage}`;
      metadata['success'] = false;
      metadata['error'] = execMessage;
      if (execError.toolName) {
        metadata['toolName'] = execError.toolName;
      }

      yield {
        chunk: `\n[Tool: ${toolCall.function.name} failed: ${execMessage}]`,
        isComplete: false,
      };
    } else {
      throw new Error(
        `[EXECUTION] Missing tool result for tool call "${toolCall.id}" in streaming mode`,
      );
    }

    conversationStore.addToolMessageWithId(content, toolCall.id, toolCall.function.name, metadata);
  }

  const streamingToolCallIds = toolCalls.map((toolCall) => {
    if (!toolCall.id || toolCall.id.length === 0) {
      throw new Error('[EXECUTION] Tool call missing id for streaming tool results ready payload');
    }
    return toolCall.id;
  });
  if (streamingToolCallIds.length === 0) {
    throw new Error('[EXECUTION] Tool results ready requires toolCallIds in streaming mode');
  }
  eventEmitter.emitExecution(
    EXECUTION_EVENTS.TOOL_RESULTS_READY,
    {
      parameters: {
        toolCallIds: streamingToolCallIds,
        round: 1,
      },
      metadata: {
        toolsExecuted: toolSummary.results.map((r) => {
          if (!r.toolName || r.toolName.length === 0) {
            throw new Error('[EXECUTION] Tool result missing toolName');
          }
          return r.toolName;
        }),
        round: 1,
      },
    },
    streamingConversationId,
    executionId,
  );
}
