/**
 * CORE-027 — the failure a result carries is the failure that happened.
 *
 * A round that ends in a provider failure records a `Request failed: …` assistant message for the
 * READER; the failure's representation is the thrown value itself, carried out of the round on
 * `IExecutionRoundState.providerFailure`. Rebuilding the error from the display prose was the
 * round trip that destroyed its class, `code`, `category`, `recoverable` flag, stack and `cause`.
 */

import type { ICoreExecutionResult } from './execution-types';
import type { TUniversalMessage } from '../interfaces/messages';
import type { ConversationStore } from '../managers/conversation-history-manager';

/**
 * The `error` a failed result carries: the ORIGINAL thrown value by identity when it was carried,
 * a wrapper for a non-Error thrown value, and a reconstruction from the display message ONLY for
 * a restored store whose failure round predates the carried value (an older session).
 */
function resolveProviderFailureError(providerFailure: unknown, response: string): Error {
  if (providerFailure instanceof Error) return providerFailure;
  if (providerFailure !== undefined) return new Error(String(providerFailure));
  return new Error(response);
}

/**
 * Build the final ICoreExecutionResult from the completed conversation store.
 */
export function buildFinalResult(
  conversationStore: ConversationStore,
  executionId: string,
  startTime: Date,
  toolsExecuted: string[],
  providerFailure?: unknown,
): ICoreExecutionResult {
  const finalMessages = conversationStore.getMessages();
  // Find last assistant message with actual content (skip stripped tool-round messages)
  const lastAssistantMessage = finalMessages
    .filter(
      (msg) =>
        msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 0,
    )
    .pop();
  const response: string = lastAssistantMessage
    ? (lastAssistantMessage.content as string)
    : 'No response received. The context window may be full.';
  // A round that ended in a provider failure records the error as an assistant message
  // with providerError metadata — that message must not count as a successful response,
  // or the failure is masked as exit 0 downstream.
  const endedWithProviderError = lastAssistantMessage?.metadata?.['providerError'] === true;
  const duration = Date.now() - startTime.getTime();
  return {
    response,
    messages: finalMessages.map((msg) => {
      if (typeof msg.content !== 'string')
        throw new Error('[EXECUTION] Message content is required');
      return {
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
        ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
        ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {}),
      };
    }) as TUniversalMessage[],
    executionId,
    duration,
    tokensUsed: finalMessages
      .filter((msg) => msg.metadata?.['usage'])
      .reduce((sum, msg) => {
        const usage = msg.metadata?.['usage'];
        if (usage && typeof usage === 'object' && 'totalTokens' in usage) {
          const totalTokens = Number(usage.totalTokens);
          if (Number.isNaN(totalTokens))
            throw new Error('[EXECUTION] totalTokens must be a number');
          return sum + totalTokens;
        }
        return sum;
      }, 0),
    toolsExecuted,
    success: !!lastAssistantMessage && !endedWithProviderError,
    // CORE-027: the ORIGINAL thrown value, by identity — see resolveProviderFailureError.
    ...(endedWithProviderError
      ? { error: resolveProviderFailureError(providerFailure, response) }
      : {}),
  };
}
