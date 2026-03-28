/**
 * Tool execution and recording for execution rounds.
 * Extracted from execution-round.ts for single-responsibility.
 */

import type { IAgentConfig } from '../interfaces/agent';
import type { IToolCall } from '../interfaces/messages';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { ConversationStore } from '../managers/conversation-history-manager';
import { getModelContextWindow } from '../context/models';
import { isExecutionError, PREVIEW_LENGTH, type IExecutionRoundState } from './execution-types';
import type { IRoundDependencies } from './execution-round';

/** Result of addToolResultsToHistory indicating whether context overflow occurred */
export interface IToolResultsOutcome {
  contextOverflowed: boolean;
  addedCount: number;
  skippedCount: number;
}

const CONTEXT_OVERFLOW_TOOL_SKIP_MESSAGE =
  'Error: Context window near capacity. Tool execution result skipped. Respond with available results and re-request skipped tools if needed.';

/** Execute tools from assistant tool calls and add results to conversation history */
export async function executeAndRecordToolCalls(
  assistantToolCalls: IToolCall[],
  conversationStore: ConversationStore,
  conversationId: string,
  executionId: string,
  currentRound: number,
  thinkingNodeId: string,
  previousThinkingNodeId: string | undefined,
  roundState: IExecutionRoundState,
  deps: IRoundDependencies,
  config?: IAgentConfig,
  signal?: AbortSignal,
): Promise<IToolResultsOutcome> {
  const { toolExecutionService, logger, eventEmitter } = deps;

  logger.debug('Tool calls detected, executing tools', {
    toolCallCount: assistantToolCalls.length,
    round: currentRound,
    toolCalls: assistantToolCalls.map((tc: IToolCall) => ({ id: tc.id, name: tc.function?.name })),
  });

  const toolOwnerPathBase = eventEmitter.buildThinkingOwnerContext(
    conversationId,
    executionId,
    thinkingNodeId,
    previousThinkingNodeId,
  ).ownerPath;
  const expectedCountForBatch = assistantToolCalls.length;
  const batchId = `${thinkingNodeId}`;
  const toolRequestsBase = toolExecutionService.createExecutionRequestsWithContext(
    assistantToolCalls,
    {
      ownerPathBase: toolOwnerPathBase,
      metadataFactory: (toolCall) => ({
        conversationId,
        round: currentRound,
        directParentId: thinkingNodeId,
        batchId,
        expectedCount: expectedCountForBatch,
        toolCallId: toolCall.id,
      }),
    },
  );
  const toolRequests = toolRequestsBase.map((request) => {
    if (!request.ownerId) {
      throw new Error('[EXECUTION] Tool request missing ownerId');
    }
    return {
      ...request,
      eventService: eventEmitter.ensureToolEventService(request.ownerId, request.ownerPath),
      baseEventService: eventEmitter.getBaseEventService(),
    };
  });
  const toolContext: IToolExecutionBatchContext = {
    requests: toolRequests,
    mode: 'parallel',
    maxConcurrency: 5,
    continueOnError: true,
    signal,
  };

  const toolSummary = await toolExecutionService.executeTools(toolContext);

  roundState.toolsExecuted.push(
    ...toolSummary.results.map((r) => {
      if (!r.toolName || r.toolName.length === 0) {
        throw new Error('[EXECUTION] Tool result missing toolName');
      }
      return r.toolName;
    }),
  );

  const contextLimit = getModelContextWindow(config?.defaultModel?.model ?? '');
  const toolResultsOutcome = addToolResultsToHistory(
    assistantToolCalls,
    toolSummary,
    conversationStore,
    currentRound,
    logger,
    { contextLimit, cumulativeInputTokens: roundState.cumulativeInputTokens },
  );

  eventEmitter.emitToolResultsEvents(
    assistantToolCalls,
    toolSummary,
    roundState.toolsExecuted,
    conversationId,
    executionId,
    currentRound,
    thinkingNodeId,
    previousThinkingNodeId,
  );

  eventEmitter.clearToolEventServices();

  return toolResultsOutcome;
}

/** Add tool execution results to conversation history in call order */
export function addToolResultsToHistory(
  assistantToolCalls: IToolCall[],
  toolSummary: {
    results: Array<{
      executionId?: string;
      toolName?: string;
      success: boolean;
      result?: unknown;
      error?: string;
    }>;
    errors: Error[];
  },
  conversationStore: ConversationStore,
  currentRound: number,
  logger: ILogger,
  contextBudget?: { contextLimit: number; cumulativeInputTokens: number },
): IToolResultsOutcome {
  const CHARS_PER_TOKEN = 2;
  const TOOL_RESULT_OVERFLOW_THRESHOLD = 0.8;
  let contextOverflowed = false;
  let addedCount = 0;
  let skippedCount = 0;

  for (const toolCall of assistantToolCalls) {
    if (!toolCall.id) {
      throw new Error(`Tool call missing ID: ${JSON.stringify(toolCall)}`);
    }
    const toolCallName = toolCall.function?.name;
    if (!toolCallName || toolCallName.length === 0) {
      throw new Error(`[EXECUTION] Tool call "${toolCall.id}" missing function name`);
    }

    if (contextOverflowed) {
      logger.warn('[ROUND] Skipping tool result due to context overflow', {
        toolCallId: toolCall.id,
        toolName: toolCallName,
        round: currentRound,
      });
      conversationStore.addToolMessageWithId(
        CONTEXT_OVERFLOW_TOOL_SKIP_MESSAGE,
        toolCall.id,
        toolCallName,
        { round: currentRound, success: false, error: 'context_overflow', toolName: toolCallName },
      );
      skippedCount++;
      continue;
    }

    const result = toolSummary.results.find((r) => r.executionId === toolCall.id);
    const error = toolSummary.errors.find(
      (e) => isExecutionError(e) && e.executionId === toolCall.id,
    );

    let content: string;
    let metadata: Record<string, string | number | boolean> = { round: currentRound };

    if (result && result.success) {
      if (typeof result.result === 'undefined') {
        throw new Error('[EXECUTION] Tool result missing result payload');
      }
      content = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      metadata['success'] = true;
      if (result.toolName) metadata['toolName'] = result.toolName;
    } else if (result && !result.success) {
      if (!result.error || result.error.length === 0) {
        throw new Error('[EXECUTION] Tool result missing error message');
      }
      content = `Error: ${result.error}`;
      metadata['success'] = false;
      metadata['error'] = result.error;
      if (result.toolName) metadata['toolName'] = result.toolName;
    } else if (error) {
      const execError = error as { error?: Error; message: string; toolName?: string };
      const execMessage = (() => {
        if (execError.error?.message) return execError.error.message;
        if (execError.message) return execError.message;
        return '';
      })();
      if (!execMessage || execMessage.length === 0) {
        throw new Error('[EXECUTION] Tool execution error missing message');
      }
      content = `Error: ${execMessage}`;
      metadata['success'] = false;
      metadata['error'] = execMessage;
      if (execError.toolName) metadata['toolName'] = execError.toolName;
    } else {
      throw new Error(`No execution result found for tool call ID: ${toolCall.id}`);
    }

    logger.debug('Adding tool result to conversation', {
      toolCallId: toolCall.id,
      toolName: toolCallName,
      content: content.substring(0, PREVIEW_LENGTH),
      round: currentRound,
      currentHistoryLength: conversationStore.getMessages().length,
    });

    conversationStore.addToolMessageWithId(content, toolCall.id, toolCallName, metadata);

    if (contextBudget) {
      const historyChars = JSON.stringify(conversationStore.getMessages()).length;
      const estimatedTokens = Math.max(
        contextBudget.cumulativeInputTokens,
        Math.ceil(historyChars / CHARS_PER_TOKEN),
      );
      if (estimatedTokens > contextBudget.contextLimit * TOOL_RESULT_OVERFLOW_THRESHOLD) {
        logger.warn(
          '[ROUND] Context budget exceeded after tool result — skipping remaining tools',
          {
            estimatedTokens,
            contextLimit: contextBudget.contextLimit,
            toolCallId: toolCall.id,
            round: currentRound,
          },
        );
        contextOverflowed = true;
      }
    }

    addedCount++;

    logger.debug('Tool result added to history', {
      toolCallId: toolCall.id,
      newHistoryLength: conversationStore.getMessages().length,
      round: currentRound,
    });
  }

  return { contextOverflowed, addedCount, skippedCount };
}
