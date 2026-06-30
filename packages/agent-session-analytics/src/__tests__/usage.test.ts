/**
 * ANALYTICS-001: source-attributed token-usage reducer.
 */

import { describe, it, expect } from 'vitest';

import { summarizeUsageBySource } from '../usage.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageSnapshot, IUsageSource } from '@robota-sdk/agent-interface-transport';

let seq = 0;
function usageEntry(total: number, source?: IUsageSource): IHistoryEntry<IUsageSnapshot> {
  seq += 1;
  const prompt = Math.round(total * 0.6);
  const completion = total - prompt;
  return {
    id: `usage-${seq}`,
    timestamp: new Date(1_700_000_000_000 + seq),
    category: 'event',
    type: 'usage-summary',
    data: {
      kind: 'exact',
      scope: 'turn',
      totalTokens: total,
      promptTokens: prompt,
      completionTokens: completion,
      contextUsedTokens: total,
      contextMaxTokens: 200_000,
      contextUsedPercentage: 0,
      costStatus: 'exact',
      ...(source ? { source } : {}),
    },
  };
}

function chatEntry(): IHistoryEntry {
  seq += 1;
  return { id: `c-${seq}`, timestamp: new Date(seq), category: 'chat', type: 'user' };
}

describe('summarizeUsageBySource (ANALYTICS-001)', () => {
  it('attributes snapshots with no source to the main thread', () => {
    const report = summarizeUsageBySource({
      id: 'sess-1',
      history: [chatEntry(), usageEntry(100), usageEntry(50)],
    });
    expect(report.totalTokens).toBe(150);
    expect(report.bySource).toHaveLength(1);
    expect(report.bySource[0]).toMatchObject({
      label: 'main thread',
      totalTokens: 150,
      turns: 2,
      percentage: 100,
    });
    expect(report.topConsumer?.label).toBe('main thread');
  });

  it('breaks usage down by source and ranks the top consumer', () => {
    const report = summarizeUsageBySource({
      id: 'sess-2',
      history: [
        usageEntry(100), // main thread (no source)
        usageEntry(300, { scope: 'background', id: 'bg-1', label: 'HARNESS-AND-CI' }),
        usageEntry(100, { scope: 'subagent', id: 'a-1', label: 'reviewer' }),
        usageEntry(200, { scope: 'background', id: 'bg-1', label: 'HARNESS-AND-CI' }),
      ],
    });

    expect(report.totalTokens).toBe(700);
    // sorted desc: background bg-1 (500) > main (100) == subagent (100) [stable by insertion]
    expect(report.bySource[0]).toMatchObject({
      label: 'HARNESS-AND-CI',
      totalTokens: 500,
      turns: 2,
      percentage: 71.4,
    });
    expect(report.topConsumer?.source.id).toBe('bg-1');
    // the background task is correctly aggregated across its two turns under one key
    const keys = report.bySource.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns an empty breakdown when no usage was recorded', () => {
    const report = summarizeUsageBySource({ id: 'sess-3', history: [chatEntry()] });
    expect(report.totalTokens).toBe(0);
    expect(report.bySource).toEqual([]);
    expect(report.topConsumer).toBeUndefined();
  });
});
