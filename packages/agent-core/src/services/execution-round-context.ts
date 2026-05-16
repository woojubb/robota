import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { ILogger } from '../utils/logger';
import type { ConversationStore } from '../managers/conversation-history-manager';
import { estimateContextTokensFromMessages } from '../context/estimation';
import { getModelContextWindow } from '../context/models';
import type { IExecutionRoundState } from './execution-types';

export const CONTEXT_HARD_BLOCK_THRESHOLD = 0.95;

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

/** Check context capacity; if near limit, add a hard-block message and return true. */
export function handleContextCapacityBlock(
  conversationMessages: readonly TUniversalMessage[],
  config: IAgentConfig,
  roundState: IExecutionRoundState,
  conversationStore: ConversationStore,
  logger: ILogger,
  currentRound: number,
): boolean {
  const contextDecision = getContextCapacityDecision(
    conversationMessages,
    config.defaultModel.model,
    roundState.cumulativeInputTokens,
  );
  if (!contextDecision.shouldBlock) return false;

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
  conversationStore.addAssistantMessage(
    `Context window is near capacity. Cannot process further in this round. Estimated ${contextDecision.estimatedTokens.toLocaleString()} / ${contextDecision.contextLimit.toLocaleString()} tokens (${Math.round(contextDecision.usedPercentage)}%) exceeds the hard-block threshold ${Math.round(contextDecision.thresholdPercentage)}%. Run /compact and retry.`,
    [],
    {
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
    },
  );
  return true;
}
