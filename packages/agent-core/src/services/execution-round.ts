import type { IAgentConfig, TExecutionEventData } from '../interfaces/agent';
import type { TUniversalMessage, TMessageState } from '../interfaces/messages';
import type { ToolExecutionService } from './tool-execution-service';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import { bindWithOwnerPath } from '../event-service/index';
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
  validateAndExtractResponse,
} from './execution-round-provider';
import { executeAndRecordToolCalls } from './execution-round-tools';
import { collectAssistantUsageMetadata } from './execution-usage';
import { handleContextCapacityBlock } from './execution-round-context';
import {
  createRoundStreamingCallbacks,
  callRoundProviderWithEvents,
} from './execution-round-streaming';
export type { IToolResultsOutcome } from './execution-round-tools';
export {
  computeRoundThinkingContext,
  callProviderWithCache,
  validateAndExtractResponse,
} from './execution-round-provider';
export { executeAndRecordToolCalls } from './execution-round-tools';
export { addToolResultsToHistory } from './execution-round-tool-results';
export {
  CONTEXT_HARD_BLOCK_THRESHOLD,
  type IContextCapacityDecision,
  getContextCapacityDecision,
} from './execution-round-context';

const MAX_CONSECUTIVE_UNKNOWN_TOOL_FAILURE_ROUNDS = 2;

/** Dependencies required by the round executor */
export interface IRoundDependencies {
  toolExecutionService: ToolExecutionService;
  plugins: ReadonlyArray<TPluginWithHooks>;
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
  cacheService?: ExecutionCacheService;
}

/** Execute a single round of the conversation loop. Returns true if loop should break. */
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

  const conversationMessages = conversationStore.getMessages();
  const { thinkingNodeId, previousThinkingNodeId } = computeRoundThinkingContext(
    conversationId,
    roundState,
  );

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
  if (
    handleContextCapacityBlock(
      conversationMessages,
      config,
      roundState,
      conversationStore,
      logger,
      currentRound,
    )
  ) {
    return true;
  }

  if (currentRound > 1) {
    fullContext.onTextDelta?.('\n\n');
  }

  conversationStore.beginAssistant();

  const { wrappedOnTextDelta, wrappedOnProviderNativeRawPayload } = createRoundStreamingCallbacks(
    fullContext,
    conversationStore,
    executionId,
    currentRound,
  );

  const response = await callRoundProviderWithEvents(
    conversationMessages,
    config,
    resolved,
    cacheService,
    fullContext,
    conversationStore,
    currentRound,
    executionId,
    logger,
    wrappedOnTextDelta,
    wrappedOnProviderNativeRawPayload,
  );
  if (response === null) return true;

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
      { added: toolOutcome.addedCount, skipped: toolOutcome.skippedCount, round: currentRound },
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
