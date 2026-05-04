/**
 * ContextWindowTracker — tracks token usage and context window state.
 *
 * Extracted from Session to separate context monitoring from conversation management.
 */

import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';
import { estimateContextTokensFromMessages, getModelContextWindow } from '@robota-sdk/agent-core';

/** Percentage conversion factor */
const PERCENT = 100;

/** Auto-compact when context usage reaches this fraction */
export const AUTO_COMPACT_THRESHOLD = 0.835;

export type TAutoCompactThreshold = number | false;

export class ContextWindowTracker {
  private contextUsedTokens = 0;
  private readonly contextMaxTokens: number;
  private autoCompactThreshold: TAutoCompactThreshold;

  constructor(
    model: string,
    contextMaxTokens?: number,
    autoCompactThreshold?: TAutoCompactThreshold,
  ) {
    this.contextMaxTokens = contextMaxTokens ?? getModelContextWindow(model);
    this.autoCompactThreshold = normalizeAutoCompactThreshold(autoCompactThreshold);
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
    if (this.autoCompactThreshold === false) {
      return false;
    }
    return this.getContextState().usedPercentage >= this.autoCompactThreshold * PERCENT;
  }

  /** The auto-compaction policy for this tracker. */
  getAutoCompactThreshold(): TAutoCompactThreshold {
    return this.autoCompactThreshold;
  }

  /** Update the auto-compaction policy for this tracker. */
  setAutoCompactThreshold(autoCompactThreshold: TAutoCompactThreshold): void {
    this.autoCompactThreshold = normalizeAutoCompactThreshold(autoCompactThreshold);
  }

  /**
   * Estimate token usage from conversation history.
   *
   * Uses the shared core estimator so session display, /context, auto-compact, and core
   * execution guards reason about the same effective token state.
   */
  updateFromHistory(history: TUniversalMessage[]): void {
    this.contextUsedTokens = estimateContextTokensFromMessages(history).usedTokens;
  }

  /** Reset token tracking */
  reset(): void {
    this.contextUsedTokens = 0;
  }
}

function normalizeAutoCompactThreshold(
  autoCompactThreshold: TAutoCompactThreshold | undefined,
): TAutoCompactThreshold {
  if (autoCompactThreshold === undefined) {
    return AUTO_COMPACT_THRESHOLD;
  }
  if (autoCompactThreshold === false) {
    return false;
  }
  if (
    !Number.isFinite(autoCompactThreshold) ||
    autoCompactThreshold <= 0 ||
    autoCompactThreshold > 1
  ) {
    throw new RangeError('autoCompactThreshold must be a number greater than 0 and at most 1.');
  }
  return autoCompactThreshold;
}
