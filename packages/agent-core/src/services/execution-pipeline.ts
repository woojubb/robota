import { EXECUTION_EVENTS } from './execution-constants';
import { buildFinalResult } from './execution-failure';
import { forceSummaryCall } from './execution-forced-summary';
import { executeRound } from './execution-round';
import { callProviderWithIdleTimeout } from './execution-round-provider';
import {
  type IResolvedProviderInfo,
  type IExecutionContext,
  type ICoreExecutionResult,
  type IExecutionRoundState,
  PREVIEW_LENGTH,
} from './execution-types';
import { callPluginHook } from './plugin-hook-dispatcher';
import { randomId } from '../utils/random-id.js';

import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import type { ToolExecutionService } from './tool-execution-service';
import type { IAgentConfig, TExecutionEventData } from '../interfaces/agent';
import type { IChatOptions } from '../interfaces/provider';
import type { TMetadata } from '../interfaces/types';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { ILogger } from '../utils/logger';
import type { ExecutionCacheService } from './cache/execution-cache-service';

const DEFAULT_MAX_EXECUTION_ROUNDS = 10;
const UNLIMITED_EXECUTION_ROUNDS = 0;

function resolveMaxExecutionRounds(config: IAgentConfig, context: IExecutionContext): number {
  const configured = context.maxExecutionRounds ?? config.maxExecutionRounds;
  if (configured === undefined) {
    return DEFAULT_MAX_EXECUTION_ROUNDS;
  }
  if (!Number.isInteger(configured) || configured < 0) {
    throw new Error('[EXECUTION] maxExecutionRounds must be a non-negative integer');
  }
  return configured;
}

function hasRoundCapacity(currentRound: number, maxRounds: number): boolean {
  return maxRounds === UNLIMITED_EXECUTION_ROUNDS || currentRound < maxRounds;
}

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
  const maxRounds = resolveMaxExecutionRounds(config, fullContext);

  while (hasRoundCapacity(roundState.currentRound, maxRounds)) {
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

  // CORE-011: a caller that already extracted its tool outcome can abort away the summary call,
  // and a decision-agent run can declare tool-only endings valid completions outright.
  if (signal?.aborted) return;
  if (fullContext.allowToolOnlyCompletion === true) return;

  if (!hasTextResponse) {
    await forceSummaryCall(
      conversationStore,
      resolved,
      config,
      executionId,
      roundState,
      conversationId,
      fullContext,
      deps.logger,
      maxRounds,
    );
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
): Promise<ICoreExecutionResult> {
  const result = {
    ...buildFinalResult(
      conversationStore,
      executionId,
      startTime,
      roundState.toolsExecuted,
      roundState.providerFailure,
    ),
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
