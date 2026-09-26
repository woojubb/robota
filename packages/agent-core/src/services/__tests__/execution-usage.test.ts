import { describe, expect, it } from 'vitest';

import { sumHistoryUsage, sumMessagesUsage } from '../execution-usage';
import { messageToHistoryEntry } from '../../interfaces/messages';

import type { IHistoryEntry, TUniversalMessage } from '../../interfaces/messages';

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

function assistantMessage(id: string, metadata: TUniversalMessage['metadata']): TUniversalMessage {
  return {
    id,
    role: 'assistant',
    content: 'x',
    state: 'complete',
    timestamp: new Date(),
    metadata,
  };
}

describe('sumMessagesUsage', () => {
  const messages: TUniversalMessage[] = [
    { id: 'u1', role: 'user', content: 'q', state: 'complete', timestamp: new Date() },
    assistantMessage('a1', { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 800 }),
    assistantMessage('a2', { inputTokens: 1200, outputTokens: 30 }),
    assistantMessage('a3', { inputTokens: 1300, outputTokens: 40, cacheReadTokens: 1100 }),
  ];

  it('sums assistant usage straight from messages, cache reads included', () => {
    expect(sumMessagesUsage(messages)).toEqual({
      promptTokens: 3500,
      completionTokens: 90,
      totalTokens: 3590,
      cacheReadTokens: 1900,
    });
  });

  it('adds no cache key when no message reported one, and undefined when none reported usage', () => {
    expect(sumMessagesUsage([messages[2]!])).toEqual({
      promptTokens: 1200,
      completionTokens: 30,
      totalTokens: 1230,
    });
    expect(sumMessagesUsage([messages[0]!])).toBeUndefined();
  });

  it('agrees with sumHistoryUsage over the same messages, which keeps exactly the triple', () => {
    const { cacheReadTokens: _cacheReadTokens, ...triple } = sumMessagesUsage(messages)!;
    expect(sumHistoryUsage(messages.map(messageToHistoryEntry))).toEqual(triple);
  });
});
