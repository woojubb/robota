/**
 * ContextWindowTracker — tracks token usage and context window state.
 *
 * Extracted from Session to separate context monitoring from conversation management.
 */

import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';

/** Known model context window sizes (tokens) */
const MODEL_CONTEXT_SIZES: Record<string, number> = {
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-opus-4-6': 1_000_000,
  'claude-opus-4-5': 200_000,
  'claude-haiku-4-5': 200_000,
};

const DEFAULT_CONTEXT_SIZE = 200_000;

/** Percentage conversion factor */
const PERCENT = 100;

/** Auto-compact when context usage reaches this fraction */
export const AUTO_COMPACT_THRESHOLD = 0.835;

export class ContextWindowTracker {
  private contextUsedTokens = 0;
  private readonly contextMaxTokens: number;

  constructor(model: string, contextMaxTokens?: number) {
    this.contextMaxTokens = contextMaxTokens ?? MODEL_CONTEXT_SIZES[model] ?? DEFAULT_CONTEXT_SIZE;
  }

  /** Get current context window state */
  getContextState(): IContextWindowState {
    const usedPercentage = Math.min(
      PERCENT,
      (this.contextUsedTokens / this.contextMaxTokens) * PERCENT,
    );
    return {
      maxTokens: this.contextMaxTokens,
      usedTokens: this.contextUsedTokens,
      usedPercentage: Math.round(usedPercentage * PERCENT) / PERCENT,
      remainingPercentage: Math.round((PERCENT - usedPercentage) * PERCENT) / PERCENT,
    };
  }

  /** Whether auto-compaction threshold has been exceeded */
  shouldAutoCompact(): boolean {
    return this.getContextState().usedPercentage >= AUTO_COMPACT_THRESHOLD * PERCENT;
  }

  /**
   * Estimate token usage from conversation history.
   *
   * First tries to read actual token counts from message metadata
   * (provider response). Falls back to character-based estimation
   * (chars / 4) which is a reasonable approximation for English/code.
   */
  updateFromHistory(history: TUniversalMessage[]): void {
    // Try metadata-based counting first
    let metadataTokens = 0;
    let hasMetadata = false;
    for (const msg of history) {
      if (msg.metadata) {
        const input = msg.metadata['inputTokens'];
        if (typeof input === 'number') {
          metadataTokens += input;
          hasMetadata = true;
        }
        const output = msg.metadata['outputTokens'];
        if (typeof output === 'number') {
          metadataTokens += output;
          hasMetadata = true;
        }
      }
    }

    if (hasMetadata) {
      this.contextUsedTokens = metadataTokens;
      return;
    }

    // Fallback: estimate from character count (chars / 4)
    const CHARS_PER_TOKEN = 4;
    const totalChars = JSON.stringify(history).length;
    this.contextUsedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  /** Reset token tracking */
  reset(): void {
    this.contextUsedTokens = 0;
  }
}
