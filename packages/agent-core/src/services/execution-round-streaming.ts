import { announceAppend } from './execution-event-helpers';
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
      // Emitted from here, not before the call, so the replay channel records the request as
      // ASSEMBLED. The structured-output guard can add a system instruction that
      // `conversationMessages` does not contain, and a `provider_request` logging the caller's own
      // array would describe a request that was never sent — `agent-session/docs/SPEC.md` promises
      // this event carries the request envelope, and a replay has to be able to reproduce it.
      (request) => {
        fullContext.onExecutionEvent?.('provider_request', {
          executionId,
          conversationId: fullContext.conversationId,
          round: currentRound,
          provider: resolved.currentInfo.provider,
          model: config.defaultModel.model,
          messages: request.messages,
          tools: resolved.availableTools,
        } as TExecutionEventData);
        // CORE-043: which transport actually carried the schema. The OUTCOME, not the resolution —
        // "the table declares json_schema" describes a catalog, while "the schema was sent as a
        // parameter, so no prompt statement was needed" explains the result the caller is holding.
        const structured = request.structuredOutput;
        if (structured !== undefined) {
          fullContext.onExecutionEvent?.('structured_output_transport', {
            executionId,
            conversationId: fullContext.conversationId,
            round: currentRound,
            provider: resolved.currentInfo.provider,
            model: config.defaultModel.model,
            mechanism: structured.capability.mechanism,
            provenance: structured.capability.provenance,
            sent: structured.sent,
            schemaInPrompt: structured.schemaInPrompt,
            ...(structured.capability.reason !== undefined && {
              reason: structured.capability.reason,
            }),
          } as TExecutionEventData);
        }
      },
    );
    // CORE-042: a provider that returned assembled text without streaming any of it still owes the
    // caller its deltas — `IChatOptions.onTextDelta`'s contract is what such a provider is violating,
    // and `run(onTextDelta)` against one emitted nothing at all before this. Routing the assembled
    // text through the SAME wrapper means both entry points get it, rather than the streaming entry
    // special-casing it and becoming a second implementation on day one.
    //
    // Emitted BEFORE the response events on purpose: every real streaming round delivers its deltas
    // ahead of the normalized response, and a replay consumer folding deltas until that arrives would
    // otherwise attribute this one to the next round.
    //
    // Stated as the TAIL rather than as "emitted nothing", because history commits the delta buffer
    // and not the returned message: a provider whose deltas stop short of its own assembled text
    // truncates the committed assistant message, silently. The no-delta case is that same bug with
    // an empty buffer. When the buffer is not a prefix of the assembled text the provider has
    // contradicted itself; that is not repaired here by guessing, but it is not passed over in
    // silence either.
    if (typeof response.content === 'string' && response.content.length > 0) {
      const streamed = conversationStore.getPendingContent();
      if (response.content.startsWith(streamed)) {
        const tail = response.content.slice(streamed.length);
        if (tail.length > 0) {
          wrappedOnTextDelta(tail);
        }
      } else {
        logger.warn(
          'Provider deltas are not a prefix of its assembled message — committing the streamed text',
          {
            conversationId: fullContext.conversationId,
            round: currentRound,
            streamedLength: streamed.length,
            assembledLength: response.content.length,
          },
        );
      }
    }
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
    // CORE-033: announced like every other append. A failed turn is precisely when a reader goes to
    // the session log, and this record was the one message the log never contained.
    announceAppend(conversationStore, fullContext, executionId, fullContext.conversationId, {
      round: currentRound,
      providerError: true,
    });
    return null;
  }
}
