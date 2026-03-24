import type { IAgentConfig, IAssistantMessage } from '../interfaces/agent';
import type { IChatOptions } from '../interfaces/provider';
import type { IToolCall, TUniversalMessage, TMessageState } from '../interfaces/messages';
import type { IToolExecutionBatchContext } from './tool-execution-service';
import type { ToolExecutionService } from './tool-execution-service';
import type { ILogger } from '../utils/logger';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ConversationSession } from '../managers/conversation-history-manager';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import { bindWithOwnerPath } from '../event-service/index';
import { getModelContextWindow } from '../context/models';
import { EXECUTION_EVENTS } from './execution-constants';
import {
  type IResolvedProviderInfo,
  type IExecutionRoundState,
  type IExecutionContext,
  isExecutionError,
  PREVIEW_LENGTH,
  SHORT_PREVIEW_LENGTH,
  LAST_MESSAGES_SLICE,
} from './execution-types';

/** Dependencies required by the round executor */
export interface IRoundDependencies {
  toolExecutionService: ToolExecutionService;
  plugins: ReadonlyArray<TPluginWithHooks>;
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
  cacheService?: ExecutionCacheService;
}

/**
 * Compute thinking node ID and previous thinking node ID for the current round
 */
export function computeRoundThinkingContext(
  conversationId: string,
  roundState: IExecutionRoundState,
): { thinkingNodeId: string; previousThinkingNodeId: string | undefined } {
  const shouldChainFromPreviousToolResult =
    Array.isArray(roundState.lastTrackedAssistantMessage?.toolCalls) &&
    roundState.lastTrackedAssistantMessage.toolCalls.length > 0;
  const thinkingNodeId = `thinking_${conversationId}_round${roundState.runningAssistantCount + 1}`;
  const previousThinkingNodeId = shouldChainFromPreviousToolResult
    ? `thinking_${conversationId}_round${roundState.runningAssistantCount}`
    : undefined;
  return { thinkingNodeId, previousThinkingNodeId };
}

/**
 * Call the AI provider with optional cache lookup/store
 */
export async function callProviderWithCache(
  conversationMessages: TUniversalMessage[],
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  cacheService?: ExecutionCacheService,
  signal?: AbortSignal,
): Promise<TUniversalMessage> {
  if (!config.defaultModel?.model) {
    throw new Error('Model is required in defaultModel configuration. Please specify a model.');
  }
  if (typeof config.defaultModel.model !== 'string' || config.defaultModel.model.trim() === '') {
    throw new Error('Model must be a non-empty string in defaultModel configuration.');
  }

  const chatOptions: IChatOptions = {
    model: config.defaultModel.model,
    ...(config.defaultModel.maxTokens !== undefined && {
      maxTokens: config.defaultModel.maxTokens,
    }),
    ...(config.defaultModel.temperature !== undefined && {
      temperature: config.defaultModel.temperature,
    }),
    ...(resolved.availableTools.length > 0 && { tools: resolved.availableTools }),
    signal,
  };

  if (cacheService) {
    const cachedResponse = cacheService.lookup(
      conversationMessages,
      config.defaultModel.model,
      config.defaultModel.provider,
      { temperature: config.defaultModel.temperature, maxTokens: config.defaultModel.maxTokens },
    );
    if (cachedResponse) {
      return { role: 'assistant', content: cachedResponse, timestamp: new Date() };
    }
    const response = await resolved.provider.chat(conversationMessages, chatOptions);
    if (typeof response.content === 'string') {
      cacheService.store(
        conversationMessages,
        config.defaultModel.model,
        config.defaultModel.provider,
        response.content,
        { temperature: config.defaultModel.temperature, maxTokens: config.defaultModel.maxTokens },
      );
    }
    return response;
  }

  return resolved.provider.chat(conversationMessages, chatOptions);
}

/**
 * Validate and normalize the provider response
 */
export function validateAndExtractResponse(
  response: TUniversalMessage,
  executionId: string,
  conversationId: string | undefined,
  currentRound: number,
  logger: ILogger,
): { assistantResponse: IAssistantMessage; assistantToolCalls: IToolCall[] } {
  const assistantToolCallsFromResponse =
    response.role === 'assistant' ? (response as IAssistantMessage).toolCalls : undefined;

  const hasToolCalls =
    Array.isArray(assistantToolCallsFromResponse) && assistantToolCallsFromResponse.length > 0;
  if (typeof response.content !== 'string' && !hasToolCalls) {
    throw new Error('[EXECUTION] Provider response must have content or tool calls');
  }
  if (assistantToolCallsFromResponse && !Array.isArray(assistantToolCallsFromResponse)) {
    throw new Error('[EXECUTION] assistant toolCalls must be an array');
  }
  const responseContent = response.content ?? '';
  logger.debug(`[ROUND-${currentRound}] Provider response completed`, {
    executionId,
    conversationId,
    round: currentRound,
    responseLength: responseContent.length,
    hasToolCalls:
      Array.isArray(assistantToolCallsFromResponse) && assistantToolCallsFromResponse.length > 0,
    toolCallsCount: Array.isArray(assistantToolCallsFromResponse)
      ? assistantToolCallsFromResponse.length
      : 0,
  });

  if (response.role !== 'assistant') {
    throw new Error(`Unexpected response role: ${response.role}`);
  }

  const assistantResponse = response as IAssistantMessage;
  const assistantToolCalls = assistantResponse.toolCalls ?? [];
  if (!Array.isArray(assistantToolCalls)) {
    throw new Error('[EXECUTION] assistantResponse.toolCalls must be an array');
  }

  return { assistantResponse, assistantToolCalls };
}

/**
 * Execute tools from assistant tool calls and add results to conversation history
 */
export async function executeAndRecordToolCalls(
  assistantToolCalls: IToolCall[],
  conversationSession: ConversationSession,
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
    conversationSession,
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

/**
 * Add tool execution results to conversation history in call order
 */
const CONTEXT_OVERFLOW_TOOL_SKIP_MESSAGE =
  'Error: Context window near capacity. Tool execution result skipped. Respond with available results and re-request skipped tools if needed.';

/** Result of addToolResultsToHistory indicating whether context overflow occurred */
export interface IToolResultsOutcome {
  /** Whether any tool results were skipped due to context overflow */
  contextOverflowed: boolean;
  /** Number of tool results that were added normally */
  addedCount: number;
  /** Number of tool results that were skipped */
  skippedCount: number;
}

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
  conversationSession: ConversationSession,
  currentRound: number,
  logger: ILogger,
  contextBudget?: { contextLimit: number; cumulativeInputTokens: number },
): IToolResultsOutcome {
  // chars/2 — conservative estimate, especially for Korean/JSON/code content
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

    // Context budget check: if already overflowed, skip remaining tool results
    if (contextOverflowed) {
      logger.warn('[ROUND] Skipping tool result due to context overflow', {
        toolCallId: toolCall.id,
        toolName: toolCallName,
        round: currentRound,
      });
      conversationSession.addToolMessageWithId(
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
      currentHistoryLength: conversationSession.getMessages().length,
    });

    conversationSession.addToolMessageWithId(content, toolCall.id, toolCallName, metadata);

    // Check context budget after adding each tool result
    if (contextBudget) {
      const historyChars = JSON.stringify(conversationSession.getMessages()).length;
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
      newHistoryLength: conversationSession.getMessages().length,
      round: currentRound,
    });
  }

  return { contextOverflowed, addedCount, skippedCount };
}

/**
 * Execute a single round of the conversation loop.
 * Returns true if the loop should break (no more tool calls).
 */
export async function executeRound(
  roundState: IExecutionRoundState,
  maxRounds: number,
  conversationSession: ConversationSession,
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

  const historyMessages = conversationSession.getMessages();
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
      content: m.content?.substring(0, PREVIEW_LENGTH),
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

  // Pre-send context check: always estimate from current history size (chars/3)
  // because cumulativeInputTokens from the previous round doesn't account for
  // tool results added after the last provider call.
  // Threshold at 83.5% matching Claude Code's approach.
  // chars/2 is more conservative than chars/3 — better for Korean, JSON, code content
  // where the actual char/token ratio is often higher than 3
  const CHARS_PER_TOKEN = 2;
  const CONTEXT_OVERFLOW_THRESHOLD = 0.835;
  const historyCharsEstimate = Math.ceil(
    JSON.stringify(conversationMessages).length / CHARS_PER_TOKEN,
  );
  // Use the higher of API-reported tokens and chars estimate to be conservative
  const estimatedTokens = Math.max(roundState.cumulativeInputTokens, historyCharsEstimate);
  const contextLimit = getModelContextWindow(config.defaultModel.model);
  if (estimatedTokens > contextLimit * CONTEXT_OVERFLOW_THRESHOLD) {
    logger.warn('[ROUND] Context overflow prevention — tokens exceed 83.5% of context window', {
      estimatedTokens,
      contextLimit,
      round: currentRound,
    });
    // Inject a clear assistant message so the caller doesn't get a cryptic fallback
    conversationSession.addAssistantMessage(
      'Context window is near capacity. Cannot process further in this round.',
      [],
      { round: currentRound, contextOverflow: true },
    );
    return true; // Break the execution loop
  }

  // Emit round separator for streaming UI — when round > 1, text from previous
  // round and this round would otherwise concatenate without any line break.
  if (currentRound > 1 && 'onTextDelta' in resolved.provider) {
    const cb = (resolved.provider as { onTextDelta?: (delta: string) => void }).onTextDelta;
    if (cb) cb('\n\n');
  }

  // Intercept onTextDelta on the provider to accumulate streaming text in ConversationSession
  const providerObj = resolved.provider as { onTextDelta?: (delta: string) => void };
  const originalOnTextDelta = providerObj.onTextDelta;
  providerObj.onTextDelta = (delta: string) => {
    conversationSession.appendStreaming(delta);
    originalOnTextDelta?.call(resolved.provider, delta);
  };

  let response: TUniversalMessage;
  try {
    response = await callProviderWithCache(
      conversationMessages,
      config,
      resolved,
      cacheService,
      fullContext.signal,
    );
    providerObj.onTextDelta = originalOnTextDelta;
  } catch (providerError) {
    providerObj.onTextDelta = originalOnTextDelta;
    // Re-throw AbortErrors so the execution service can handle them cleanly.
    if (providerError instanceof Error && providerError.name === 'AbortError') {
      throw providerError;
    }
    // Provider rejected the request (e.g., context too large for API).
    // Inject a clear assistant message instead of propagating the error.
    const errMsg = providerError instanceof Error ? providerError.message : String(providerError);
    logger.error('[ROUND] Provider call failed', { error: errMsg, round: currentRound });
    conversationSession.addAssistantMessage(`Provider error: ${errMsg}`, [], {
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
    {
      messages: conversationMessages,
      responseMessage: response,
    },
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

  // Accumulate authoritative token count from API response
  if (inputTokens > 0) {
    roundState.cumulativeInputTokens = inputTokens; // input_tokens already includes full context
  }

  // If provider did not stream (no onTextDelta calls), seed pending state with full response content.
  // This handles non-streaming providers and test mocks that return content directly.
  if (assistantResponse.content && !conversationSession.hasPendingAssistant()) {
    conversationSession.appendStreaming(assistantResponse.content);
  }

  // Extract tool calls from provider response and add to pending state
  for (const tc of assistantToolCalls) {
    conversationSession.appendToolCall(tc);
  }

  // Single commit path — state determined by signal
  const messageState: TMessageState = fullContext.signal?.aborted ? 'interrupted' : 'complete';
  conversationSession.commitAssistant(messageState, {
    round: currentRound,
    ...(inputTokens > 0 && { inputTokens }),
    ...(outputTokens > 0 && { outputTokens }),
    // Preserve usage.totalTokens for execution-service token accounting
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
    conversationSession,
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
    // Don't break — let the AI see the mixed results (normal + context error)
    // and decide how to respond (partial answer, request /compact, retry, etc.)
  }

  logger.debug(
    `Round ${currentRound} completed - continuing to next round for agent ${fullContext.conversationId}`,
  );
  return false;
}
