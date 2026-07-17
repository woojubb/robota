import { describe, expect, it } from 'vitest';

import { buildResult, createUsageSummaryEntry } from '../interactive-session-execution.js';

import type { IContextWindowState, TUniversalMessage } from '@robota-sdk/agent-core';

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

  // SELFHOST-004 TC-06: extractTurnUsage resolves the turn's model id and populates costUsd via the
  // model-pricing SSOT (exact input/output split), flipping costStatus 'unknown' → 'exact'.
  it('TC-06: populates costUsd + flips costStatus to exact for a priced model', () => {
    const sessionHistory: TUniversalMessage[] = [
      { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
        metadata: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    // gpt-4o = $2.5/M input, $10/M output → (100/1e6)*2.5 + (50/1e6)*10 = 0.00075.
    const result = buildResult('done', sessionHistory, [], 0, CONTEXT_STATE, undefined, 'gpt-4o');

    expect(result.usage?.costStatus).toBe('exact');
    expect(result.usage?.costUsd).toBeCloseTo(0.00075, 10);
  });

  it('TC-06: leaves costUsd absent + costStatus unknown for an unpriced model', () => {
    const sessionHistory: TUniversalMessage[] = [
      { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
        metadata: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = buildResult(
      'done',
      sessionHistory,
      [],
      0,
      CONTEXT_STATE,
      undefined,
      'no-such-model-xyz',
    );

    expect(result.usage?.costStatus).toBe('unknown');
    expect(result.usage?.costUsd).toBeUndefined();
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
