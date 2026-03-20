import type { IAgentConfig, IAssistantMessage } from '../interfaces/agent';
import type { TMetadata } from '../interfaces/types';
import type { IAIProviderManager } from '../interfaces/manager';
import type { IToolManager } from '../interfaces/manager';
import type { IChatOptions } from '../interfaces/provider';
import type { TUniversalMessage } from '../interfaces/messages';

/** Preview length for general content truncation */
export const PREVIEW_LENGTH = 100;

/** Preview length for content previews in event data */
export const CONTENT_PREVIEW_LENGTH = 200;

/** Preview length for short previews in debug logs */
export const SHORT_PREVIEW_LENGTH = 50;

/** Average words per minute for reading time estimation */
export const WORDS_PER_MINUTE = 200;

/** Threshold for high complexity response length */
export const HIGH_COMPLEXITY_THRESHOLD = 1000;

/** Threshold for medium complexity response length */
export const MEDIUM_COMPLEXITY_THRESHOLD = 300;

/** Threshold for high input complexity character count */
export const HIGH_INPUT_COMPLEXITY_THRESHOLD = 200;

/** Threshold for medium input complexity character count */
export const MEDIUM_INPUT_COMPLEXITY_THRESHOLD = 50;

/** Number of recent messages to show in debug logs */
export const LAST_MESSAGES_SLICE = -5;

/** Radix for random ID generation */
export const ID_RADIX = 36;

/** Length of random portion of generated IDs */
export const ID_RANDOM_LENGTH = 9;

/**
 * Provider and tools information resolved at the start of execution
 */
export interface IResolvedProviderInfo {
  provider: {
    chat: (messages: TUniversalMessage[], options: IChatOptions) => Promise<TUniversalMessage>;
  };
  currentInfo: { provider: string };
  aiProviderInfo: {
    providerName: string;
    model: string;
    temperature: number | undefined;
    maxTokens: number | undefined;
  };
  toolsInfo: Array<{
    name: string;
    description: string;
    parameters: string[];
  }>;
  availableTools: ReturnType<IToolManager['getTools']>;
}

/**
 * Mutable state tracked across execution rounds
 */
export interface IExecutionRoundState {
  toolsExecuted: string[];
  currentRound: number;
  runningAssistantCount: number;
  lastTrackedAssistantMessage: IAssistantMessage | undefined;
}

/**
 * Error with optional execution-specific properties
 */
export interface IExecutionError extends Error {
  executionId?: string;
  toolName?: string;
  error?: Error;
}

/**
 * Type guard to check if error has execution properties
 */
export function isExecutionError(error: Error): error is IExecutionError {
  return 'executionId' in error || 'toolName' in error;
}

/**
 * Execution context for service operations.
 * Applies Type Deduplication Rule: Use standardized metadata type
 */
export interface IExecutionContext {
  conversationId?: string;
  sessionId?: string;
  userId?: string;
  messages: TUniversalMessage[];
  config: IAgentConfig;
  metadata?: TMetadata;
  startTime: Date;
  executionId: string;
}

/**
 * Execution result containing the response and execution metadata
 */
export interface IExecutionResult {
  response: string;
  messages: TUniversalMessage[];
  executionId: string;
  duration: number;
  tokensUsed?: number;
  toolsExecuted: string[];
  success: boolean;
  error?: Error;
}

/**
 * History statistics type returned by ConversationHistory.getStats()
 */
export interface IHistoryStats {
  totalConversations: number;
  conversationIds: string[];
  totalMessages: number;
}

/**
 * Plugin statistics type - using a simpler structure
 */
export interface IExecutionServicePluginStats {
  pluginCount: number;
  pluginNames: string[];
  historyStats: IHistoryStats;
}

/**
 * Count words in text without allocating an intermediate array.
 * Avoids the cost of split(/\s+/) in hot paths.
 */
export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const isSpace = text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r';
    if (!isSpace && !inWord) {
      count++;
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }
  return count;
}
