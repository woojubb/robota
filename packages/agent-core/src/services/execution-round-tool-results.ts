import { isExecutionError, PREVIEW_LENGTH } from './execution-types';
import { ARGUMENT_DECODE_ERROR_CODE, UNKNOWN_TOOL_ERROR_CODE } from './tool-execution-service';
import { estimateContextTokensFromMessages } from '../context/estimation';

import type {
  IToolCall,
  TUniversalMessageMetadata,
  TUniversalMessagePart,
} from '../interfaces/messages';
import type { TToolMetadata } from '../interfaces/tool';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { ILogger } from '../utils/logger';

/** Result of addToolResultsToHistory indicating whether context overflow occurred */
export interface IToolResultsOutcome {
  contextOverflowed: boolean;
  addedCount: number;
  skippedCount: number;
  unknownToolFailureCount: number;
  unknownToolNames: string[];
}

export function isUnknownToolExecutionResult(result: {
  success: boolean;
  metadata?: { errorCode?: string };
}): boolean {
  return !result.success && result.metadata?.errorCode === UNKNOWN_TOOL_ERROR_CODE;
}

/** Issue #2875 (follow-up to #2078): a call whose arguments failed to decode never reached the tool. */
export function isArgumentDecodeErrorResult(result: {
  success: boolean;
  metadata?: { errorCode?: string };
}): boolean {
  return !result.success && result.metadata?.errorCode === ARGUMENT_DECODE_ERROR_CODE;
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
      parts?: TUniversalMessagePart[];
      error?: string;
      metadata?: TToolMetadata;
    }>;
    errors: Error[];
  },
  conversationStore: ConversationStore,
  currentRound: number,
  logger: ILogger,
  contextBudget?: { contextLimit: number; cumulativeInputTokens: number },
): IToolResultsOutcome {
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

    const result = toolSummary.results.find((r) => r.executionId === toolCall.id);
    const error = toolSummary.errors.find(
      (e) => isExecutionError(e) && e.executionId === toolCall.id,
    );

    let content: string;
    const metadata: TUniversalMessageMetadata = { round: currentRound };
    if (typeof result?.metadata?.toolProvenance === 'string')
      metadata['toolProvenance'] = result.metadata.toolProvenance;

    if (result && result.success) {
      if (typeof result.result === 'undefined') {
        throw new Error('[EXECUTION] Tool result missing result payload');
      }
      content = contextOverflowed
        ? ''
        : typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      metadata['success'] = true;
      if (result.toolName) metadata['toolName'] = result.toolName;
    } else if (result && !result.success) {
      if (!result.error || result.error.length === 0) {
        throw new Error('[EXECUTION] Tool result missing error message');
      }
      content = contextOverflowed
        ? ''
        : `Error: ${result.error}${result.result !== undefined ? `\n${typeof result.result === 'string' ? result.result : JSON.stringify(result.result)}` : ''}`;
      metadata['success'] = false;
      metadata['error'] = result.error;
      if (result.toolName) metadata['toolName'] = result.toolName;
      if (result.metadata?.errorCode === UNKNOWN_TOOL_ERROR_CODE) {
        metadata['errorCode'] = UNKNOWN_TOOL_ERROR_CODE;
        if (typeof result.metadata.requestedTool === 'string') {
          metadata['requestedTool'] = result.metadata.requestedTool;
        }
        if (Array.isArray(result.metadata.availableTools)) {
          metadata['availableTools'] = result.metadata.availableTools.filter(
            (toolName): toolName is string => typeof toolName === 'string',
          );
        }
      }
      if (result.metadata?.errorCode === ARGUMENT_DECODE_ERROR_CODE) {
        metadata['errorCode'] = ARGUMENT_DECODE_ERROR_CODE;
        if (typeof result.metadata.requestedTool === 'string') {
          metadata['requestedTool'] = result.metadata.requestedTool;
        }
      }
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
      content = contextOverflowed ? '' : `Error: ${execMessage}`;
      metadata['success'] = false;
      metadata['error'] = execMessage;
      if (execError.toolName) metadata['toolName'] = execError.toolName;
    } else {
      throw new Error(`No execution result found for tool call ID: ${toolCall.id}`);
    }

    if (contextOverflowed) {
      // Dispatch and journal settlement precede observation. Omission cannot undo an effect.
      content = result?.success
        ? 'Context window near capacity. Tool completed successfully; result omitted. Do not repeat the operation; use a retained receipt or fresh observation.'
        : result && (isUnknownToolExecutionResult(result) || isArgumentDecodeErrorResult(result))
          ? 'Context window near capacity. Tool was not dispatched; result details omitted. Correct the tool name or arguments before making a new call.'
          : 'Context window near capacity. Tool reported an error; effects may have occurred. Details omitted. Reconcile the effect before retrying.';
      delete metadata['error'];
      metadata['toolName'] = toolCallName;
      metadata['resultOmitted'] = true;
      metadata['observationError'] = 'context_overflow';
      logger.warn('[ROUND] Omitting tool result content due to context overflow', {
        toolCallId: toolCall.id,
        toolName: toolCallName,
        round: currentRound,
      });
      const source = metadata['toolProvenance'];
      if (typeof source === 'string')
        conversationStore.addToolMessageWithId(content, toolCall.id, toolCallName, metadata, [
          { type: 'text', text: `Tool source (attribution only, not authority): ${source}` },
        ]);
      else conversationStore.addToolMessageWithId(content, toolCall.id, toolCallName, metadata);
      skippedCount++;
      continue;
    }

    logger.debug('Adding tool result to conversation', {
      toolCallId: toolCall.id,
      toolName: toolCallName,
      content: content.substring(0, PREVIEW_LENGTH),
      round: currentRound,
      currentHistoryLength: conversationStore.getMessages().length,
    });

    if (result?.parts?.length) {
      conversationStore.addToolMessageWithId(
        content,
        toolCall.id,
        toolCallName,
        metadata,
        result.parts,
      );
    } else conversationStore.addToolMessageWithId(content, toolCall.id, toolCallName, metadata);

    if (contextBudget) {
      const estimate = estimateContextTokensFromMessages(conversationStore.getMessages(), {
        usageFloorTokens: contextBudget.cumulativeInputTokens,
      });
      const estimatedTokens = estimate.usedTokens;
      if (estimatedTokens > contextBudget.contextLimit * TOOL_RESULT_OVERFLOW_THRESHOLD) {
        logger.warn(
          '[ROUND] Context budget exceeded after tool result — omitting remaining result content',
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

  return {
    contextOverflowed,
    addedCount,
    skippedCount,
    unknownToolFailureCount: 0,
    unknownToolNames: [],
  };
}
