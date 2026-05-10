/**
 * Execution round orchestrator.
 * Provider helpers → execution-round-provider.ts
 * Tool recording → execution-round-tools.ts
 */

import type { IAgentConfig, TExecutionEventData } from '../interfaces/agent';
import type { TProviderNativeRawPayloadCallback } from '../interfaces/provider';
import type { TUniversalMessage, TMessageState } from '../interfaces/messages';
import type { ToolExecutionService } from './tool-execution-service';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import { bindWithOwnerPath } from '../event-service/index';
import { estimateContextTokensFromMessages } from '../context/estimation';
import { getModelContextWindow } from '../context/models';
import { EXECUTION_EVENTS } from './execution-constants';
import {
  type IResolvedProviderInfo,
  type IExecutionRoundState,
  type IExecutionContext,
  SHORT_PREVIEW_LENGTH,
  LAST_MESSAGES_SLICE,
} from './execution-types';
import {
  computeRoundThinkingContext,
  callProviderWithCache,
  validateAndExtractResponse,
} from './execution-round-provider';
import { executeAndRecordToolCalls } from './execution-round-tools';
import { collectAssistantUsageMetadata } from './execution-usage';
export type { IToolResultsOutcome } from './execution-round-tools';
export {
  computeRoundThinkingContext,
  callProviderWithCache,
  validateAndExtractResponse,
} from './execution-round-provider';
export { executeAndRecordToolCalls, addToolResultsToHistory } from './execution-round-tools';

export const CONTEXT_HARD_BLOCK_THRESHOLD = 0.95;
const MAX_CONSECUTIVE_UNKNOWN_TOOL_FAILURE_ROUNDS = 2;

export interface IContextCapacityDecision {
  readonly shouldBlock: boolean;
  readonly estimatedTokens: number;
  readonly contextLimit: number;
  readonly thresholdTokens: number;
  readonly thresholdPercentage: number;
  readonly usedPercentage: number;
  readonly serializedTokens: number;
  readonly providerTokens?: number;
  readonly usageFloorTokens?: number;
}

export function getContextCapacityDecision(
  messages: readonly TUniversalMessage[],
  model: string,
  usageFloorTokens: number,
): IContextCapacityDecision {
  const estimate = estimateContextTokensFromMessages(messages, { usageFloorTokens });
  const contextLimit = getModelContextWindow(model);
  const thresholdTokens = contextLimit * CONTEXT_HARD_BLOCK_THRESHOLD;
  const usedPercentage =
    contextLimit > 0 ? Math.round((estimate.usedTokens / contextLimit) * 10_000) / 100 : 100;

  return {
    shouldBlock: estimate.usedTokens > thresholdTokens,
    estimatedTokens: estimate.usedTokens,
    contextLimit,
    thresholdTokens,
    thresholdPercentage: CONTEXT_HARD_BLOCK_THRESHOLD * 100,
    usedPercentage,
    serializedTokens: estimate.serializedTokens,
    ...(estimate.providerTokens !== undefined && { providerTokens: estimate.providerTokens }),
    ...(estimate.usageFloorTokens !== undefined && {
      usageFloorTokens: estimate.usageFloorTokens,
    }),
  };
}

/** Dependencies required by the round executor */
export interface IRoundDependencies {
  toolExecutionService: ToolExecutionService;
  plugins: ReadonlyArray<TPluginWithHooks>;
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
  cacheService?: ExecutionCacheService;
}

/**
 * Execute a single round of the conversation loop.
 * Returns true if the loop should break (no more tool calls).
 */
export async function executeRound(
  roundState: IExecutionRoundState,
  maxRounds: number,
  conversationStore: ConversationStore,
  conversationId: string,
  executionId: string,
  fullContext: IExecutionContext,
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  deps: IRoundDependencies,
): Promise<boolean> {
  const { plugins, logger, eventEmitter, cacheService } = deps;
  const currentRound = roundState.currentRound;

  logger.debug(`[ROUND-${currentRound}] Starting execution round ${currentRound}`, {
    executionId,
    conversationId: fullContext.conversationId,
    round: currentRound,
    maxRounds,
  });

  const historyMessages = conversationStore.getMessages();
  if (!Array.isArray(historyMessages)) {
    throw new Error('[EXECUTION] Conversation messages must be an array');
  }

  const { thinkingNodeId, previousThinkingNodeId } = computeRoundThinkingContext(
    conversationId,
    roundState,
  );

  const conversationMessages = historyMessages;

  logger.debug('Current conversation messages', {
    round: currentRound,
    messageCount: conversationMessages.length,
    fullHistory: conversationMessages.map((m, index) => ({
      index,
      role: m.role,
      content: m.content?.substring(0, 100),
      hasToolCalls: 'toolCalls' in m ? !!m.toolCalls?.length : false,
      toolCallId: 'toolCallId' in m ? m.toolCallId : undefined,
      toolCallsCount: 'toolCalls' in m ? m.toolCalls?.length : 0,
    })),
  });

  await callPluginHook(plugins, 'beforeProviderCall', { messages: conversationMessages }, logger);

  logger.debug('Sending messages to AI provider', {
    round: currentRound,
    messageCount: conversationMessages.length,
    lastFewMessages: conversationMessages.slice(LAST_MESSAGES_SLICE).map((m) => ({
      role: m.role,
      content: m.content?.substring(0, SHORT_PREVIEW_LENGTH),
      hasToolCalls: 'toolCalls' in m ? !!m.toolCalls?.length : false,
      toolCallId: 'toolCallId' in m ? m.toolCallId : undefined,
    })),
  });

  eventEmitter.emitWithContext(
    EXECUTION_EVENTS.ASSISTANT_MESSAGE_START,
    {
      parameters: { round: currentRound, messageCount: conversationMessages.length },
      metadata: { round: currentRound, thinkingNodeId },
    },
    () =>
      eventEmitter.buildThinkingOwnerContext(
        conversationId,
        executionId,
        thinkingNodeId,
        previousThinkingNodeId,
      ),
    (ctx) => {
      if (!ctx.ownerType || !ctx.ownerId) {
        throw new Error('[EXECUTION] Missing owner context for thinking event');
      }
      return bindWithOwnerPath(eventEmitter.getBaseEventService(), {
        ownerType: ctx.ownerType,
        ownerId: ctx.ownerId,
        ownerPath: ctx.ownerPath,
      });
    },
  );

  // Pre-send hard-capacity check. Routine compaction is owned by agent-sessions; this guard is
  // only a last safety stop when the effective context estimate is already near the model limit.
  const contextDecision = getContextCapacityDecision(
    conversationMessages,
    config.defaultModel.model,
    roundState.cumulativeInputTokens,
  );
  if (contextDecision.shouldBlock) {
    logger.warn('[ROUND] Context hard-capacity prevention before provider call', {
      estimatedTokens: contextDecision.estimatedTokens,
      contextLimit: contextDecision.contextLimit,
      thresholdTokens: contextDecision.thresholdTokens,
      thresholdPercentage: contextDecision.thresholdPercentage,
      serializedTokens: contextDecision.serializedTokens,
      providerTokens: contextDecision.providerTokens ?? 0,
      usageFloorTokens: contextDecision.usageFloorTokens ?? 0,
      round: currentRound,
    });
    const overflowMetadata = {
      round: currentRound,
      contextOverflow: true,
      estimatedTokens: contextDecision.estimatedTokens,
      contextLimit: contextDecision.contextLimit,
      thresholdTokens: contextDecision.thresholdTokens,
      thresholdPercentage: contextDecision.thresholdPercentage,
      serializedTokens: contextDecision.serializedTokens,
      providerTokens: contextDecision.providerTokens ?? 0,
      usageFloorTokens: contextDecision.usageFloorTokens ?? 0,
      usedPercentage: contextDecision.usedPercentage,
    };
    conversationStore.addAssistantMessage(
      `Context window is near capacity. Cannot process further in this round. Estimated ${contextDecision.estimatedTokens.toLocaleString()} / ${contextDecision.contextLimit.toLocaleString()} tokens (${Math.round(contextDecision.usedPercentage)}%) exceeds the hard-block threshold ${Math.round(contextDecision.thresholdPercentage)}%. Run /compact and retry.`,
      [],
      overflowMetadata,
    );
    return true;
  }

  const runTextDelta = fullContext.onTextDelta;

  // Round separator for streaming UI
  if (currentRound > 1) {
    runTextDelta?.('\n\n');
  }

  conversationStore.beginAssistant();

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
    runTextDelta?.(delta);
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

  let response: TUniversalMessage;
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
    response = await callProviderWithCache(conversationMessages, config, resolved, cacheService, {
      signal: fullContext.signal,
      onTextDelta: wrappedOnTextDelta,
      onProviderNativeRawPayload: wrappedOnProviderNativeRawPayload,
    });
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
  } catch (providerError) {
    const isAbortError =
      providerError instanceof Error &&
      (providerError.name === 'AbortError' ||
        providerError.message.includes('aborted') ||
        providerError.message.includes('abort'));
    if (isAbortError) {
      conversationStore.commitAssistant('interrupted', { round: currentRound });
      throw providerError;
    }
    conversationStore.discardPending();
    const errMsg = providerError instanceof Error ? providerError.message : String(providerError);
    logger.error('[ROUND] Provider call failed', { error: errMsg, round: currentRound });
    conversationStore.addAssistantMessage(`Request failed: ${errMsg}`, [], {
      round: currentRound,
      providerError: true,
    });
    return true;
  }

  const { assistantResponse, assistantToolCalls } = validateAndExtractResponse(
    response,
    executionId,
    fullContext.conversationId,
    currentRound,
    logger,
  );

  await callPluginHook(
    plugins,
    'afterProviderCall',
    { messages: conversationMessages, responseMessage: response },
    logger,
  );

  const responseHasText =
    typeof assistantResponse.content === 'string' && assistantResponse.content.trim().length > 0;
  if (assistantToolCalls.length === 0 && !responseHasText) {
    logger.warn('[ROUND] Provider returned empty assistant response without tool calls', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
    });
    conversationStore.discardPending();
    return true;
  }

  const usageMetadata = collectAssistantUsageMetadata(assistantResponse);
  const inputTokens = usageMetadata?.inputTokens ?? 0;

  if (inputTokens > 0) {
    roundState.cumulativeInputTokens = inputTokens;
  }

  if (assistantResponse.content && !conversationStore.getPendingContent()) {
    conversationStore.appendStreaming(assistantResponse.content);
  }

  for (const tc of assistantToolCalls) {
    conversationStore.appendToolCall(tc);
  }

  const messageState: TMessageState = fullContext.signal?.aborted ? 'interrupted' : 'complete';
  conversationStore.commitAssistant(messageState, {
    round: currentRound,
    ...(usageMetadata ?? {}),
  });
  const committedAssistantMessage = conversationStore.getMessages().at(-1);
  fullContext.onExecutionEvent?.('assistant_message_committed', {
    executionId,
    conversationId: fullContext.conversationId,
    round: currentRound,
    message: assistantResponse,
  } as TExecutionEventData);
  if (committedAssistantMessage) {
    fullContext.onExecutionEvent?.('history_mutation', {
      executionId,
      conversationId: fullContext.conversationId,
      round: currentRound,
      mutation: 'append_message',
      index: conversationStore.getMessages().length - 1,
      message: committedAssistantMessage,
    } as TExecutionEventData);
  }
  roundState.runningAssistantCount++;
  roundState.lastTrackedAssistantMessage = assistantResponse;

  if (assistantToolCalls.length === 0) {
    logger.debug(
      `[AGENT-FLOW-CONTROL] Round ${currentRound} completed - no tool calls, execution finished for agent ${fullContext.conversationId}`,
    );
    eventEmitter.emitAssistantMessageComplete(
      assistantResponse,
      executionId,
      currentRound,
      conversationId,
      thinkingNodeId,
      previousThinkingNodeId,
    );
    return true;
  }

  const toolOutcome = await executeAndRecordToolCalls(
    assistantToolCalls,
    conversationStore,
    conversationId,
    executionId,
    currentRound,
    thinkingNodeId,
    previousThinkingNodeId,
    roundState,
    deps,
    config,
    fullContext.signal,
    fullContext.onExecutionEvent,
  );

  if (toolOutcome.contextOverflowed) {
    logger.warn(
      '[ROUND] Tool results partially skipped due to context overflow — continuing to let AI respond',
      {
        added: toolOutcome.addedCount,
        skipped: toolOutcome.skippedCount,
        round: currentRound,
      },
    );
  }

  if (toolOutcome.unknownToolFailureCount > 0) {
    roundState.consecutiveUnknownToolFailureRounds += 1;
  } else {
    roundState.consecutiveUnknownToolFailureRounds = 0;
  }

  if (
    roundState.consecutiveUnknownToolFailureRounds >= MAX_CONSECUTIVE_UNKNOWN_TOOL_FAILURE_ROUNDS
  ) {
    const unavailableTools = [...new Set(toolOutcome.unknownToolNames)].sort();
    roundState.forcedSummaryInstruction = [
      `The model repeatedly requested unavailable tool(s): ${unavailableTools.join(', ')}.`,
      'Those tool calls were not executed because they are not registered tools.',
      'Respond to the user now with that reason and use the available tool results already in the conversation history.',
    ].join(' ');
    logger.warn('[ROUND] Stopping repeated unavailable tool-call loop', {
      unavailableTools,
      consecutiveRounds: roundState.consecutiveUnknownToolFailureRounds,
      round: currentRound,
    });
    return true;
  }

  logger.debug(
    `Round ${currentRound} completed - continuing to next round for agent ${fullContext.conversationId}`,
  );
  return false;
}
