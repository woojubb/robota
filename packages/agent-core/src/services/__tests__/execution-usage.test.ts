import { describe, expect, it } from 'vitest';

import { sumHistoryUsage } from '../execution-usage';

import type { IHistoryEntry } from '../../interfaces/messages';

function assistantEntry(id: string, inputTokens: number, outputTokens: number): IHistoryEntry {
  return {
    id,
    timestamp: new Date(),
    category: 'chat',
    type: 'assistant',
    data: { role: 'assistant', content: 'x', metadata: { inputTokens, outputTokens } },
  };
}

describe('sumHistoryUsage (ANALYTICS-001 Phase 2)', () => {
  it('sums assistant token usage across a sub-session history', () => {
    const totals = sumHistoryUsage([
      assistantEntry('a1', 100, 40),
      { id: 'e1', timestamp: new Date(), category: 'event', type: 'tool-start' },
      assistantEntry('a2', 60, 20),
    ]);
    expect(totals).toEqual({ promptTokens: 160, completionTokens: 60, totalTokens: 220 });
  });

  it('returns undefined when no usage is reported', () => {
    expect(
      sumHistoryUsage([{ id: 'u', timestamp: new Date(), category: 'chat', type: 'user' }]),
    ).toBeUndefined();
  });
});
