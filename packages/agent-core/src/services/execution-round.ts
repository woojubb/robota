/**
 * Execution round orchestrator.
 * Provider helpers → execution-round-provider.ts
 * Tool recording → execution-round-tools.ts
 */

import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage, TMessageState } from '../interfaces/messages';
import type { ToolExecutionService } from './tool-execution-service';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import { bindWithOwnerPath } from '../event-service/index';
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
export type { IToolResultsOutcome } from './execution-round-tools';
export {
  computeRoundThinkingContext,
  callProviderWithCache,
  validateAndExtractResponse,
} from './execution-round-provider';
export { executeAndRecordToolCalls, addToolResultsToHistory } from './execution-round-tools';

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

  // Pre-send context check
  const CHARS_PER_TOKEN = 2;
  const CONTEXT_OVERFLOW_THRESHOLD = 0.835;
  const historyCharsEstimate = Math.ceil(
    JSON.stringify(conversationMessages).length / CHARS_PER_TOKEN,
  );
  const estimatedTokens = Math.max(roundState.cumulativeInputTokens, historyCharsEstimate);
  const contextLimit = getModelContextWindow(config.defaultModel.model);
  if (estimatedTokens > contextLimit * CONTEXT_OVERFLOW_THRESHOLD) {
    logger.warn('[ROUND] Context overflow prevention — tokens exceed 83.5% of context window', {
      estimatedTokens,
      contextLimit,
      round: currentRound,
    });
    conversationStore.addAssistantMessage(
      'Context window is near capacity. Cannot process further in this round.',
      [],
      { round: currentRound, contextOverflow: true },
    );
    return true;
  }

  // Round separator for streaming UI
  if (currentRound > 1 && 'onTextDelta' in resolved.provider) {
    const cb = (resolved.provider as { onTextDelta?: (delta: string) => void }).onTextDelta;
    if (cb) cb('\n\n');
  }

  conversationStore.beginAssistant();

  const originalOnTextDelta = (resolved.provider as { onTextDelta?: (delta: string) => void })
    .onTextDelta;
  const wrappedOnTextDelta = (delta: string): void => {
    conversationStore.appendStreaming(delta);
    originalOnTextDelta?.call(resolved.provider, delta);
  };

  let response: TUniversalMessage;
  try {
    response = await callProviderWithCache(conversationMessages, config, resolved, cacheService, {
      signal: fullContext.signal,
      onTextDelta: wrappedOnTextDelta,
    });
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

  const inputTokens =
    typeof assistantResponse.metadata?.['inputTokens'] === 'number'
      ? assistantResponse.metadata['inputTokens']
      : 0;
  const outputTokens =
    typeof assistantResponse.metadata?.['outputTokens'] === 'number'
      ? assistantResponse.metadata['outputTokens']
      : 0;

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
    ...(inputTokens > 0 && { inputTokens }),
    ...(outputTokens > 0 && { outputTokens }),
    ...((inputTokens > 0 || outputTokens > 0) && {
      usage: { totalTokens: inputTokens + outputTokens, inputTokens, outputTokens },
    }),
  });
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

  logger.debug(
    `Round ${currentRound} completed - continuing to next round for agent ${fullContext.conversationId}`,
  );
  return false;
}
