import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { ContextWindowTracker } from './context-window-tracker.js';

const NOW = new Date('2026-05-05T00:00:00.000Z');

function userMessage(content: string): TUniversalMessage {
  return {
    id: `user-${content.length}`,
    role: 'user',
    content,
    state: 'complete',
    timestamp: NOW,
  };
}

function assistantMessage(inputTokens: number, outputTokens: number): TUniversalMessage {
  return {
    id: `assistant-${inputTokens}-${outputTokens}`,
    role: 'assistant',
    content: 'previous',
    state: 'complete',
    timestamp: NOW,
    metadata: { inputTokens, outputTokens },
  };
}

describe('ContextWindowTracker', () => {
  it('TC-02: falls back to serialized estimate when the latest message carries no usage', () => {
    const tracker = new ContextWindowTracker('claude-haiku-4-5', 200_000);

    // Latest message (the giant user message) has no provider usage → serialized estimate dominates.
    tracker.updateFromHistory([assistantMessage(1_000, 100), userMessage('x'.repeat(320_000))]);

    const state = tracker.getContextState();
    expect(state.usedTokens).toBeGreaterThanOrEqual(80_000);
    expect(state.usedPercentage).toBeLessThan(50);
    expect(tracker.shouldAutoCompact()).toBe(false);
  });

  it('TC-01: reflects the provider-reported tokens (system prompt + tools) when the latest message carries usage', () => {
    const tracker = new ContextWindowTracker('claude-haiku-4-5', 200_000);

    // Tiny serialized history, but the provider counted 40.5K tokens for the last turn — i.e. the
    // system prompt + tool schemas + history the model actually processed. The crude serialized
    // estimate (a few dozen tokens) would massively under-report; the accurate estimator must use
    // the provider total.
    tracker.updateFromHistory([userMessage('hi'), assistantMessage(40_000, 500)]);

    const state = tracker.getContextState();
    expect(state.usedTokens).toBeGreaterThanOrEqual(40_000);
  });
});
