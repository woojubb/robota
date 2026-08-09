import { callProviderWithCache } from './execution-round-provider';
import { resolveToolChoiceForRound } from './execution-service-helpers';
import { isAbortFailure } from '../utils/abort-classification';

import type { IExecutionContext, IResolvedProviderInfo } from './execution-types';
import type { IAgentConfig, TExecutionEventData } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { TProviderNativeRawPayloadCallback } from '../interfaces/provider';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ILogger } from '../utils/logger';

export interface IRoundStreamingCallbacks {
  wrappedOnTextDelta: (delta: string) => void;
  wrappedOnProviderNativeRawPayload: TProviderNativeRawPayloadCallback;
}

export function createRoundStreamingCallbacks(
  fullContext: IExecutionContext,
  conversationStore: ConversationStore,
  executionId: string,
  currentRound: number,
): IRoundStreamingCallbacks {
  let streamDeltaSequence = 0;
  let providerNativeRawPayloadSequence = 0;

  const wrappedOnTextDelta = (delta: string): void => {
    fullContext.onExecutionEvent?.('provider_stream_raw_delta', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
      sequence: streamDeltaSequence,
      delta,
    } as TExecutionEventData);
    streamDeltaSequence++;
    conversationStore.appendStreaming(delta);
    fullContext.onTextDelta?.(delta);
  };

  const wrappedOnProviderNativeRawPayload: TProviderNativeRawPayloadCallback = (event): void => {
    const sequence = event.sequence ?? providerNativeRawPayloadSequence;
    providerNativeRawPayloadSequence = Math.max(providerNativeRawPayloadSequence, sequence + 1);
    fullContext.onExecutionEvent?.('provider_native_raw_payload', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
      ...event,
      sequence,
    } as TExecutionEventData);
  };

  return { wrappedOnTextDelta, wrappedOnProviderNativeRawPayload };
}

/** Call the provider with event emissions. Returns null if round should break; throws on abort. */
export async function callRoundProviderWithEvents(
  conversationMessages: TUniversalMessage[],
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  cacheService: ExecutionCacheService | undefined,
  fullContext: IExecutionContext,
  conversationStore: ConversationStore,
  currentRound: number,
  executionId: string,
  logger: ILogger,
  wrappedOnTextDelta: (delta: string) => void,
  wrappedOnProviderNativeRawPayload: TProviderNativeRawPayloadCallback,
  onProviderFailure?: (error: unknown) => void,
): Promise<TUniversalMessage | null> {
  try {
    fullContext.onExecutionEvent?.('provider_request', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
      provider: resolved.currentInfo.provider,
      model: config.defaultModel.model,
      messages: conversationMessages,
      tools: resolved.availableTools,
    } as TExecutionEventData);
    const response = await callProviderWithCache(
      conversationMessages,
      config,
      resolved,
      cacheService,
      {
        signal: fullContext.signal,
        onTextDelta: wrappedOnTextDelta,
        onProviderNativeRawPayload: wrappedOnProviderNativeRawPayload,
        // CORE-016/017: run-scoped model option overrides win over defaultModel.
        ...(fullContext.maxTokens !== undefined && { maxTokens: fullContext.maxTokens }),
        ...(fullContext.temperature !== undefined && { temperature: fullContext.temperature }),
        // Forcing directives apply to round 1 only — later rounds revert to 'auto' so the
        // model can consume tool results and finish (resolved against run-then-default).
        ...(() => {
          const effectiveToolChoice = resolveToolChoiceForRound(
            fullContext.toolChoice ?? config.defaultModel.toolChoice,
            currentRound,
          );
          return effectiveToolChoice !== undefined ? { toolChoice: effectiveToolChoice } : {};
        })(),
      },
    );
    fullContext.onExecutionEvent?.('provider_response_raw', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
      response,
      responseKind: 'provider-normalized-message',
    } as TExecutionEventData);
    fullContext.onExecutionEvent?.('provider_response_normalized', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
      response,
      toolCallsCount:
        response.role === 'assistant' && Array.isArray(response.toolCalls)
          ? response.toolCalls.length
          : 0,
    } as TExecutionEventData);
    return response;
  } catch (providerError) {
    // allow-fallback: provider errors terminate the round, not the process
    //
    // CORE-027: classified from the SIGNAL this round was given and from the error's own name, never
    // from its prose. The substring test that stood here committed the round as `interrupted` for
    // any provider failure whose message happened to contain "abort".
    if (isAbortFailure(providerError, fullContext.signal)) {
      conversationStore.commitAssistant('interrupted', { round: currentRound });
      throw providerError;
    }
    conversationStore.discardPending();
    // CORE-027: the message below is DISPLAY, not the failure's representation. The thrown value
    // itself is handed out so the final result can carry it with class, code, category, stack and
    // cause intact — rebuilding it from this prose is the round trip that destroyed all of them.
    onProviderFailure?.(providerError);
    const errMsg = providerError instanceof Error ? providerError.message : String(providerError);
    logger.error('[ROUND] Provider call failed', { error: errMsg, round: currentRound });
    conversationStore.addAssistantMessage(`Request failed: ${errMsg}`, [], {
      round: currentRound,
      providerError: true,
    });
    return null;
  }
}
