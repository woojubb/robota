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

const NO_RESPONSE_TEXT = 'No response received. The context window may be full.';

/**
 * Which turn a result describes, and how that turn is allowed to end.
 *
 * The store holds the whole conversation, so a result read from all of it answered for earlier
 * turns: a turn that produced no text resolved with the PREVIOUS turn's answer, and `tokensUsed`
 * re-counted every earlier call on every run.
 */
export interface IFinalResultScope {
  /** Index of this turn's user message in the store; only messages from here on are the turn's. */
  readonly turnStartIndex: number;
  /** CORE-011: a turn that ends in tool results, with no text after them, is complete. */
  readonly allowToolOnlyCompletion?: boolean;
  /** The run was aborted: it resolves with the text committed so far, never as a failure. */
  readonly interrupted?: boolean;
}

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

function isAssistantText(msg: TUniversalMessage): boolean {
  return msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 0;
}

/**
 * Build the final ICoreExecutionResult from the completed conversation store.
 */
export function buildFinalResult(
  conversationStore: ConversationStore,
  executionId: string,
  startTime: Date,
  toolsExecuted: string[],
  scope: IFinalResultScope,
  providerFailure?: unknown,
): ICoreExecutionResult {
  const finalMessages = conversationStore.getMessages();
  const turnMessages = finalMessages.slice(scope.turnStartIndex);
  // Last assistant message of THIS turn with actual content (skip stripped tool-round messages)
  const lastAssistantMessage = turnMessages.filter(isAssistantText).pop();
  // A round that ended in a provider failure records the error as an assistant message
  // with providerError metadata — that message must not count as a successful response,
  // or the failure is masked as exit 0 downstream.
  const endedWithProviderError = lastAssistantMessage?.metadata?.['providerError'] === true;
  const endedInToolResults = turnMessages[turnMessages.length - 1]?.role === 'tool';
  const toolOnlyCompletion =
    scope.allowToolOnlyCompletion === true && endedInToolResults && !lastAssistantMessage;
  const response: string = lastAssistantMessage
    ? (lastAssistantMessage.content as string)
    : toolOnlyCompletion || scope.interrupted === true
      ? ''
      : NO_RESPONSE_TEXT;
  const failed =
    scope.interrupted !== true &&
    (endedWithProviderError || (!lastAssistantMessage && !toolOnlyCompletion));
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
    tokensUsed: turnMessages
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
    success: !failed,
    // CORE-027: the ORIGINAL thrown value, by identity — see resolveProviderFailureError.
    ...(failed && endedWithProviderError
      ? { error: resolveProviderFailureError(providerFailure, response) }
      : {}),
  };
}
