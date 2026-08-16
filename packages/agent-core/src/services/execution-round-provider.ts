/**
 * Provider call helpers for execution rounds.
 * Extracted from execution-round.ts for single-responsibility.
 */

import { applyModelToolCapability } from './execution-model-capability-guards.js';
import { assertToolChoiceValid, buildChatResponseFormat } from './execution-service-helpers';
import { applyStructuredOutputTransport } from './execution-structured-output-guard.js';
import { randomId } from '../utils/random-id.js';

import type { IStructuredOutputTransportOutcome } from './execution-structured-output-guard';
import type { IResolvedProviderInfo, IExecutionRoundState } from './execution-types';
import type { IAgentConfig, IAssistantMessage } from '../interfaces/agent';
import type { IToolCall, TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions } from '../interfaces/provider';
import type { ILogger } from '../utils/logger';
import type { ExecutionCacheService } from './cache/execution-cache-service';

type TProviderChat = (
  messages: TUniversalMessage[],
  options: IChatOptions,
) => Promise<TUniversalMessage>;

/** Compute thinking context IDs for event tracking */
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

/** Assemble the wire options for one round, before any capability guard has adjusted them. */
function buildRoundChatOptions(
  model: string,
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  overrides: Partial<IChatOptions> | undefined,
): IChatOptions {
  const responseFormat = buildChatResponseFormat(config.responseFormat);
  return {
    model,
    // Default the reasoning-effort dial to 'high' at the framework→provider seam so every
    // model call carries an explicit effort (design §5.1 — neutral default 'high').
    effort: config.defaultModel?.effort ?? 'high',
    ...(config.defaultModel?.maxTokens !== undefined && {
      maxTokens: config.defaultModel.maxTokens,
    }),
    ...(config.defaultModel?.temperature !== undefined && {
      temperature: config.defaultModel.temperature,
    }),
    ...(config.defaultModel?.toolChoice !== undefined && {
      toolChoice: config.defaultModel.toolChoice,
    }),
    ...(resolved.availableTools.length > 0 && { tools: resolved.availableTools }),
    ...(responseFormat ? { responseFormat } : {}),
    ...overrides,
  };
}

/** Call the AI provider with optional cache lookup/store */
export async function callProviderWithCache(
  conversationMessages: TUniversalMessage[],
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  cacheService?: ExecutionCacheService,
  overrides?: Partial<IChatOptions>,
  /**
   * CORE-043: where the structured-output outcome is reported. A callback rather than a field on
   * `IResolvedProviderInfo`, because the report is about THIS request, not about the provider — the
   * caller closes over the run's event emitter so the outcome travels the replay channel like every
   * other observable step of the turn.
   */
  onStructuredOutputTransport?: (outcome: IStructuredOutputTransportOutcome) => void,
): Promise<TUniversalMessage> {
  if (!config.defaultModel?.model) {
    throw new Error('Model is required in defaultModel configuration. Please specify a model.');
  }
  if (typeof config.defaultModel.model !== 'string' || config.defaultModel.model.trim() === '') {
    throw new Error('Model must be a non-empty string in defaultModel configuration.');
  }

  const model = config.defaultModel.model;
  const chatOptions = buildRoundChatOptions(model, config, resolved, overrides);
  assertToolChoiceValid(chatOptions.toolChoice, chatOptions.tools);
  // PROV-006: what this MODEL can be asked to do, as opposed to what its vendor can.
  applyModelToolCapability(chatOptions, model, resolved);
  // CORE-043: which transport can carry the schema — decided before the call rather than discovered
  // by spending the retry budget. `outgoing` may carry a prompt statement of the schema, so every
  // use below (cache key included) reads it rather than the caller's history array.
  const { messages: outgoing, outcome: structuredOutcome } = applyStructuredOutputTransport(
    chatOptions,
    conversationMessages,
    model,
    resolved,
  );
  if (structuredOutcome) {
    onStructuredOutputTransport?.(structuredOutcome);
  }
  const providerChat = resolved.provider.chat.bind(resolved.provider) as TProviderChat;

  if (cacheService) {
    const cachedResponse = cacheService.lookup(
      outgoing,
      config.defaultModel.model,
      config.defaultModel.provider,
      { temperature: config.defaultModel.temperature, maxTokens: config.defaultModel.maxTokens },
    );
    if (cachedResponse) {
      return {
        role: 'assistant',
        content: cachedResponse,
        timestamp: new Date(),
        id: randomId(),
        state: 'complete' as const,
      };
    }
    const response = await callProviderWithIdleTimeout(
      providerChat,
      outgoing,
      chatOptions,
      config.timeout,
    );
    if (typeof response.content === 'string') {
      cacheService.store(
        outgoing,
        config.defaultModel.model,
        config.defaultModel.provider,
        response.content,
        { temperature: config.defaultModel.temperature, maxTokens: config.defaultModel.maxTokens },
      );
    }
    return response;
  }

  return callProviderWithIdleTimeout(providerChat, outgoing, chatOptions, config.timeout);
}

/**
 * Call a provider honouring the run's cancellation signal and the configured idle timeout.
 *
 * Exported so that every provider call in the execution turn goes through one implementation --
 * CORE-042: the forced-summary call was the last one built by hand, and it silently had neither.
 */
export async function callProviderWithIdleTimeout(
  chat: TProviderChat,
  messages: TUniversalMessage[],
  options: IChatOptions,
  timeoutMs: number | undefined,
): Promise<TUniversalMessage> {
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const upstreamSignal = options.signal;
  if (normalizedTimeoutMs === undefined && upstreamSignal === undefined) {
    return chat(messages, options);
  }
  if (upstreamSignal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let rejectGuard: ((reason: Error) => void) | undefined;

  const clearIdleTimer = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const failWith = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectGuard?.(error);
    controller.abort(error);
  };

  const resetIdleTimer = (): void => {
    if (normalizedTimeoutMs === undefined || settled) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      failWith(new Error(`Provider call idle timeout after ${normalizedTimeoutMs}ms`));
    }, normalizedTimeoutMs);
  };

  const handleUpstreamAbort = (): void => {
    failWith(createAbortError());
  };
  upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true });

  const originalOnTextDelta = options.onTextDelta;
  const guardedOptions: IChatOptions = {
    ...options,
    signal: controller.signal,
    ...(originalOnTextDelta !== undefined
      ? {
          onTextDelta: (delta: string): void => {
            resetIdleTimer();
            originalOnTextDelta(delta);
          },
        }
      : {}),
  };

  resetIdleTimer();

  try {
    return await Promise.race([
      chat(messages, guardedOptions),
      new Promise<never>((_, reject) => {
        rejectGuard = reject;
      }),
    ]);
  } finally {
    settled = true;
    clearIdleTimer();
    upstreamSignal?.removeEventListener('abort', handleUpstreamAbort);
  }
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return timeoutMs;
}

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

/** Validate and normalize the provider response */
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
