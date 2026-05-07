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
  it('includes metadata-free prompt text even when previous provider usage exists', () => {
    const tracker = new ContextWindowTracker('claude-haiku-4-5', 200_000);

    tracker.updateFromHistory([assistantMessage(1_000, 100), userMessage('x'.repeat(320_000))]);

    const state = tracker.getContextState();
    expect(state.usedTokens).toBeGreaterThanOrEqual(80_000);
    expect(state.usedPercentage).toBeLessThan(50);
    expect(tracker.shouldAutoCompact()).toBe(false);
  });
});
