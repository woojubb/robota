import { describe, expect, it } from 'vitest';
import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';
import { buildResult, createUsageSummaryEntry } from '../interactive-session-execution.js';

const CONTEXT_STATE: IContextWindowState = {
  maxTokens: 1000,
  usedTokens: 150,
  usedPercentage: 15,
  remainingPercentage: 85,
};

describe('interactive session usage summaries', () => {
  it('extracts exact provider usage from completed assistant messages', () => {
    const sessionHistory: TUniversalMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'hello',
        state: 'complete',
        timestamp: new Date(),
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
        metadata: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = buildResult('done', sessionHistory, [], 0, CONTEXT_STATE);

    expect(result.usage).toEqual({
      kind: 'exact',
      scope: 'turn',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      contextUsedTokens: 150,
      contextMaxTokens: 1000,
      contextUsedPercentage: 15,
      costStatus: 'unknown',
    });
  });

  it('creates persisted usage-summary history entries', () => {
    const usage = {
      kind: 'exact' as const,
      scope: 'turn' as const,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      contextUsedTokens: 150,
      contextMaxTokens: 1000,
      contextUsedPercentage: 15,
      costStatus: 'unknown' as const,
    };

    const entry = createUsageSummaryEntry(usage);

    expect(entry.category).toBe('event');
    expect(entry.type).toBe('usage-summary');
    expect(entry.data).toEqual(usage);
  });
});
