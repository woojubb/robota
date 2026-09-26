/**
 * Context window tracking types.
 *
 * These types are used by agent-sessions (and downstream packages) to
 * track token usage and context window state across conversation turns.
 */

/** Token usage from a single API call (Anthropic-style granularity) */
export interface IContextTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  /**
   * Anthropic-style: cache reads counted in addition to `inputTokens`. Not the message-usage
   * `cacheReadTokens` (`IMessageTokenUsage`), which is a part of the input.
   */
  cacheReadTokens?: number;
}

/** Context window state snapshot */
export interface IContextWindowState {
  /** Max tokens for the current model */
  maxTokens: number;
  /** Current estimated token usage (input + cache, excludes output) */
  usedTokens: number;
  /** Usage percentage (0-100) */
  usedPercentage: number;
  /** Remaining percentage (0-100) */
  remainingPercentage: number;
}
