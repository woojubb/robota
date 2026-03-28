import type { IAgentConfig } from '../interfaces/agent';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import { callPluginHook } from './plugin-hook-dispatcher';
import type { ILogger } from '../utils/logger';
import type { TMetadata } from '../interfaces/types';
import type { ExecutionEventEmitter } from './execution-event-emitter';
import { EXECUTION_EVENTS } from './execution-constants';
import { randomUUID } from 'node:crypto';
import type { ToolExecutionService } from './tool-execution-service';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import { executeRound } from './execution-round';
import {
  type IResolvedProviderInfo,
  type IExecutionContext,
  type IExecutionResult,
  type IExecutionRoundState,
  PREVIEW_LENGTH,
} from './execution-types';
import { buildFinalResult } from './execution-service-helpers';

/** Dependencies for running the execution round loop */
export interface IExecutionRoundDeps {
  toolExecutionService: ToolExecutionService;
  plugins: TPluginWithHooks[];
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
  cacheService?: ExecutionCacheService;
}

/**
 * Run the execution round loop and (if needed) force a summary call at the end.
 * Mutates roundState.
 */
export async function runExecutionLoop(
  conversationStore: ConversationStore,
  conversationId: string,
  executionId: string,
  fullContext: IExecutionContext,
  config: IAgentConfig,
  resolved: IResolvedProviderInfo,
  roundState: IExecutionRoundState,
  signal: AbortSignal | undefined,
  deps: IExecutionRoundDeps,
): Promise<void> {
  const maxRounds = 10;

  while (roundState.currentRound < maxRounds) {
    if (signal?.aborted) break;
    roundState.currentRound++;
    const shouldBreak = await executeRound(
      roundState,
      maxRounds,
      conversationStore,
      conversationId,
      executionId,
      fullContext,
      config,
      resolved,
      deps,
    );
    if (shouldBreak) break;
    if (signal?.aborted) break;
  }

  // If loop ended without a final text response (e.g., maxRounds reached while
  // AI was still issuing tool calls), make one more provider call so the AI
  // can generate a summary from the results collected so far.
  const allMsgs = conversationStore.getMessages();
  const lastMsg = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1] : undefined;
  const hasTextResponse =
    lastMsg?.role === 'assistant' &&
    typeof lastMsg.content === 'string' &&
    lastMsg.content.length > 0 &&
    (!('toolCalls' in lastMsg) || (lastMsg.toolCalls as unknown[]).length === 0);

  if (!hasTextResponse) {
    await forceSummaryCall(
      conversationStore,
      resolved,
      config,
      executionId,
      roundState,
      conversationId,
      deps.logger,
    );
  }
}

/**
 * When max rounds are exhausted without a text response, force one final provider call
 * to generate a summary.
 */
export async function forceSummaryCall(
  conversationStore: ConversationStore,
  resolved: IResolvedProviderInfo,
  config: IAgentConfig,
  executionId: string,
  roundState: IExecutionRoundState,
  conversationId: string,
  logger: ILogger,
): Promise<void> {
  const maxRounds = 10;
  logger.warn('No final text response — forcing summary call', {
    maxRounds,
    currentRound: roundState.currentRound,
    conversationId,
  });
  try {
    const syntheticMsg =
      'Tool round limit reached. Provide your response based on the information gathered so far. If results are incomplete, let the user know what was covered and what remains — the user can request additional analysis in a follow-up message.';
    conversationStore.addUserMessage(syntheticMsg);
    const summaryMessages = conversationStore.getMessages();
    const systemMsg = config.systemMessage ?? '';

    const hasSystemMsg = summaryMessages.some(
      (m) => m.role === 'system' && m.content === systemMsg,
    );
    const messagesForProvider =
      systemMsg && !hasSystemMsg
        ? [
            {
              id: randomUUID(),
              role: 'system' as const,
              content: systemMsg,
              state: 'complete' as const,
              timestamp: new Date(),
            },
            ...summaryMessages,
          ]
        : summaryMessages;

    const chatOptions: { model: string; onTextDelta?: (delta: string) => void } = {
      model: resolved.aiProviderInfo.model,
    };
    if ('onTextDelta' in resolved.provider && typeof resolved.provider.onTextDelta === 'function') {
      chatOptions.onTextDelta = resolved.provider.onTextDelta as (delta: string) => void;
    }

    const forceResponse = await resolved.provider.chat(messagesForProvider, chatOptions);

    // Remove synthetic message from history to avoid polluting conversation
    const currentMessages = conversationStore.getMessages();
    const syntheticIndex = currentMessages.findIndex(
      (m) => m.role === 'user' && m.content === syntheticMsg,
    );
    if (syntheticIndex !== -1) {
      const cleaned = currentMessages.filter(
        (m) => !(m.role === 'user' && m.content === syntheticMsg),
      );
      conversationStore.clear();
      for (const m of cleaned) {
        conversationStore.addMessage(m);
      }
    }

    const responseText = typeof forceResponse.content === 'string' ? forceResponse.content : '';
    if (responseText) {
      conversationStore.addAssistantMessage(responseText, [], forceResponse.metadata);
    } else {
      conversationStore.addAssistantMessage(
        'Maximum rounds reached. Partial results available in conversation history.',
      );
    }
  } catch (forceErr) {
    logger.warn('Forced summary call failed', {
      error: forceErr instanceof Error ? forceErr.message : String(forceErr),
    });
  }
}

/**
 * Finalize the execution after all rounds complete:
 * calls afterRun hooks, logs success, emits COMPLETE event, and returns the result.
 */
export async function finalizeExecution(
  input: string,
  conversationStore: ConversationStore,
  executionId: string,
  startTime: Date,
  roundState: IExecutionRoundState,
  conversationId: string,
  interrupted: boolean,
  context: Partial<IExecutionContext> | undefined,
  plugins: TPluginWithHooks[],
  logger: ILogger,
  eventEmitter: ExecutionEventEmitter,
): Promise<IExecutionResult> {
  const result = {
    ...buildFinalResult(conversationStore, executionId, startTime, roundState.toolsExecuted),
    interrupted,
  };

  await callPluginHook(
    plugins,
    'afterRun',
    {
      input,
      response: result.response,
      metadata: context?.metadata as TMetadata,
    },
    logger,
  );

  logger.debug('Execution pipeline completed successfully', {
    executionId,
    conversationId,
    duration: result.duration,
    tokensUsed: result.tokensUsed,
    toolsExecuted: result.toolsExecuted.length,
    rounds: roundState.currentRound,
  });

  eventEmitter.emitExecution(
    EXECUTION_EVENTS.COMPLETE,
    {
      result: {
        success: true,
        data: result.response.substring(0, PREVIEW_LENGTH) + '...',
      },
      metadata: {
        method: 'execute',
        success: true,
        duration: result.duration,
        tokensUsed: result.tokensUsed,
        toolsExecuted: result.toolsExecuted,
      },
    },
    conversationId,
    executionId,
  );

  return result;
}
