import { announceAppend } from './execution-event-helpers';
import { callProviderWithIdleTimeout } from './execution-round-provider';
import { PROVIDER_CALL_EVENTS } from '../event-service/span-events';
import { isAbortFailure } from '../utils/abort-classification';
import { randomId } from '../utils/random-id.js';
import { verifiedProviderCallUsage } from './provider-call-usage';
import { resolveProviderCallTraceContext, withOutboundTraceContext } from './execution-trace-context';

import type {
  IExecutionContext,
  IExecutionRoundState,
  IResolvedProviderInfo,
} from './execution-types';
import type { IAgentConfig, TExecutionEventData } from '../interfaces/agent';
import type { IChatOptions } from '../interfaces/provider';
import type { TUniversalMessage } from '../interfaces/messages';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { ILogger } from '../utils/logger';

const DEFAULT_MAX_EXECUTION_ROUNDS = 10;
const UNLIMITED_EXECUTION_ROUNDS = 0;

/**
 * When max rounds are exhausted without a text response, force one final provider call
 * to generate a summary.
 *
 * Its own file (CORE-033): the loop that decides WHETHER to force a summary and the call that
 * PERFORMS one are separate responsibilities, and this one grew a request assembly, a transport
 * option set and three replay-event emissions of its own — enough that keeping it beside the loop
 * pushed `execution-pipeline.ts` past the file ceiling.
 */
export async function forceSummaryCall(
  conversationStore: ConversationStore,
  resolved: IResolvedProviderInfo,
  config: IAgentConfig,
  executionId: string,
  roundState: IExecutionRoundState,
  conversationId: string,
  fullContext: IExecutionContext,
  logger: ILogger,
  maxRounds: number = DEFAULT_MAX_EXECUTION_ROUNDS,
): Promise<void> {
  logger.warn('No final text response — forcing summary call', {
    maxRounds: maxRounds === UNLIMITED_EXECUTION_ROUNDS ? 'unlimited' : maxRounds,
    currentRound: roundState.currentRound,
    conversationId,
  });
  try {
    const syntheticMsg =
      roundState.forcedSummaryInstruction ??
      'Tool round limit reached. Provide your response based on the information gathered so far. If results are incomplete, let the user know what was covered and what remains — the user can request additional analysis in a follow-up message.';
    // CORE-033: the instruction is a per-call prompt artifact, not conversation. It used to be
    // APPENDED to the store, sent, then taken back out with `clear()` + re-add — a non-append
    // rewrite of an append-only history that no event described, so a replay driven from the
    // session log could not reconstruct the store even in principle. It now only ever exists in the
    // OUTGOING array, the same shape `applyStructuredOutputTransport` uses for the schema
    // instruction (CORE-043). Nothing is added, so nothing has to be removed.
    const summaryMessages = [
      ...conversationStore.getMessages(),
      {
        id: randomId(),
        role: 'user' as const,
        content: syntheticMsg,
        state: 'complete' as const,
        timestamp: new Date(),
      },
    ];
    const systemMsg = config.systemMessage ?? '';

    const hasSystemMsg = summaryMessages.some(
      (m) => m.role === 'system' && m.content === systemMsg,
    );
    const messagesForProvider =
      systemMsg && !hasSystemMsg
        ? [
            {
              id: randomId(),
              role: 'system' as const,
              content: systemMsg,
              state: 'complete' as const,
              timestamp: new Date(),
            },
            ...summaryMessages,
          ]
        : summaryMessages;

    // CORE-042: this was the one provider call in the turn built by hand -- `{ model, onTextDelta }`,
    // carrying no `signal`, no `effort` and no idle timeout. That was survivable while the streaming
    // path had its own engine; now that the streaming entry awaits the turn when its consumer walks
    // away, an unabortable call here is a hang on the public streaming API. It goes through the same
    // helper every round call goes through, so there is one implementation of "call the provider".
    // Tools stay deliberately absent: this call exists to END the tool loop, not to extend it.
    const chatOptions: IChatOptions = {
      model: resolved.aiProviderInfo.model,
      effort: config.defaultModel?.effort ?? 'auto',
      // Provider-hosted tools can be enabled by adapter configuration even when no local
      // schemas are passed. A forced summary must remain a text-only terminal call.
      toolChoice: 'none',
      ...(config.defaultModel?.maxTokens !== undefined && {
        maxTokens: config.defaultModel.maxTokens,
      }),
      ...(config.defaultModel?.temperature !== undefined && {
        temperature: config.defaultModel.temperature,
      }),
      ...(fullContext.signal && { signal: fullContext.signal }),
      ...(fullContext.onTextDelta && { onTextDelta: fullContext.onTextDelta }),
    };

    // CORE-033: this is a provider call like any other, so it announces itself like one. The SPEC
    // declares `provider_request` REQUIRED, and a replay that cannot see the call the summary came
    // from cannot explain the summary. Emitted with the ASSEMBLED array, for the reason
    // `execution-round-streaming` gives: the request the model received, not the caller's history.
    fullContext.onExecutionEvent?.('provider_request', {
      executionId,
      conversationId,
      round: roundState.currentRound,
      provider: resolved.currentInfo.provider,
      model: resolved.aiProviderInfo.model,
      messages: messagesForProvider,
      forcedSummary: true,
    } as TExecutionEventData);

    const startedAtMs = Date.now();
    const callId = randomId();
    const dispatch: { invoked: boolean; startedAtMs?: number } = { invoked: false };
    let providerOutcome: 'success' | 'failure' | 'interrupted' = 'failure';
    let forceResponse: TUniversalMessage | undefined;
    try {
      forceResponse = await callProviderWithIdleTimeout(
        (messages, options) => {
          // The same adapter-invocation boundary as normal rounds; internal retries stay opaque.
          dispatch.invoked = true;
          dispatch.startedAtMs = Date.now();
          const outbound = resolveProviderCallTraceContext(
            fullContext.traceContext,
            resolved.provider,
            resolved.currentInfo.provider,
            callId,
          );
          return resolved.provider.chat(messages, withOutboundTraceContext(options, outbound));
        },
        messagesForProvider,
        chatOptions,
        config.timeout,
        fullContext.awaitProviderSettlement,
      );
      providerOutcome = 'success';
    } catch (error) {
      if (isAbortFailure(error, fullContext.signal)) providerOutcome = 'interrupted';
      throw error;
    } finally {
      const usage = dispatch.invoked ? verifiedProviderCallUsage(forceResponse) : { provenance: 'absent' as const };
      fullContext.onExecutionEvent?.(PROVIDER_CALL_EVENTS.COMPLETED, {
        executionId,
        conversationId,
        round: roundState.currentRound,
        startedAt: new Date(dispatch.startedAtMs ?? startedAtMs).toISOString(),
        endedAt: new Date(Math.max(Date.now(), dispatch.startedAtMs ?? startedAtMs)).toISOString(),
        outcome: providerOutcome,
        callId,
        disposition: dispatch.invoked ? 'invoked' : 'preflight-refused',
        ...(dispatch.invoked && {
          providerId: resolved.currentInfo.provider,
          modelId: resolved.aiProviderInfo.model,
          ...(typeof forceResponse?.metadata?.['providerRequestId'] === 'string' && {
            providerRequestId: forceResponse.metadata['providerRequestId'],
          }),
        }),
        usageProvenance: usage.provenance,
        ...('promptTokens' in usage && usage.promptTokens !== undefined && {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        }),
      } as TExecutionEventData);
    }

    if (!forceResponse) throw new Error('Forced summary provider returned no response.');

    const responseText = typeof forceResponse.content === 'string' ? forceResponse.content : '';
    const committedText =
      responseText || 'Maximum rounds reached. Partial results available in conversation history.';
    const verifiedUsage = verifiedProviderCallUsage(forceResponse);
    const summaryMetadata = {
      ...(forceResponse.metadata ?? {}),
      round: roundState.currentRound,
      providerId: resolved.currentInfo.provider,
      modelId: resolved.aiProviderInfo.model,
      usageProvenance: verifiedUsage.provenance,
      ...(verifiedUsage.provenance === 'complete' && {
        inputTokens: verifiedUsage.promptTokens,
        outputTokens: verifiedUsage.completionTokens,
        totalTokens: verifiedUsage.totalTokens,
      }),
    };
    conversationStore.addAssistantMessage(committedText, [], summaryMetadata);
    // CORE-033: the summary is the turn's answer; committing it silently left the last thing the
    // user reads absent from every replay of the conversation.
    fullContext.onExecutionEvent?.('assistant_message_committed', {
      executionId,
      conversationId,
      round: roundState.currentRound,
      message: committedText,
    } as TExecutionEventData);
    announceAppend(conversationStore, fullContext, executionId, conversationId, {
      round: roundState.currentRound,
    });
  } catch (forceErr) {
    logger.warn('Forced summary call failed', {
      error: forceErr instanceof Error ? forceErr.message : String(forceErr),
    });
  }
}
