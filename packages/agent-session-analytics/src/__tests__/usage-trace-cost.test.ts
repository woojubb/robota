/**
 * SELFHOST-004 P3 (TC-01 / TC-03): the trace/cost read-model over a session record.
 *
 * TC-01 — `summarizeUsageBySource` produces per-source COST totals AND the span timeline, grouping
 *         sub-turn spans under their owning turn (asserting the grouping, not just span presence).
 * TC-03 — no cap-enforcement is added here (the reducer stays a pure read-model) — placement grep.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { summarizeUsageBySource } from '../usage.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  ISpanEntry,
  IUsageSnapshot,
  IUsageSource,
} from '@robota-sdk/agent-interface-transport';

let seq = 0;

function usageEntry(
  total: number,
  opts: { source?: IUsageSource; costUsd?: number } = {},
): IHistoryEntry<IUsageSnapshot> {
  seq += 1;
  const prompt = Math.round(total * 0.6);
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
      completionTokens: total - prompt,
      contextUsedTokens: total,
      contextMaxTokens: 200_000,
      contextUsedPercentage: 0,
      costStatus: opts.costUsd !== undefined ? 'exact' : 'unknown',
      ...(opts.costUsd !== undefined ? { costUsd: opts.costUsd } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    },
  };
}

function spanEntry(op: string, durationMs: number): IHistoryEntry<ISpanEntry> {
  seq += 1;
  return {
    id: `span-${seq}`,
    timestamp: new Date(1_700_000_000_000 + seq),
    category: 'event',
    type: 'span',
    data: { spanId: `span_${seq}`, op, durationMs },
  };
}

describe('SELFHOST-004 TC-01 — cost-by-source + span timeline', () => {
  it('sums exact per-turn cost per source and across the session', () => {
    const worker: IUsageSource = { scope: 'subagent', id: 'w1', label: 'worker 1' };
    const report = summarizeUsageBySource({
      id: 'sess-cost',
      history: [
        usageEntry(100, { costUsd: 0.01 }),
        usageEntry(200, { costUsd: 0.02 }),
        usageEntry(50, { source: worker, costUsd: 0.005 }),
      ],
    });

    expect(report.costUsd).toBeCloseTo(0.035, 6);
    expect(report.costExact).toBe(true);
    const main = report.bySource.find((s) => s.label === 'main thread');
    const w1 = report.bySource.find((s) => s.label === 'worker 1');
    expect(main?.costUsd).toBeCloseTo(0.03, 6);
    expect(w1?.costUsd).toBeCloseTo(0.005, 6);
  });

  it('marks the aggregate inexact and contributes 0 when a turn is unpriced', () => {
    const report = summarizeUsageBySource({
      id: 'sess-unpriced',
      history: [usageEntry(100, { costUsd: 0.01 }), usageEntry(200) /* unpriced */],
    });

    expect(report.costUsd).toBeCloseTo(0.01, 6);
    expect(report.costExact).toBe(false);
    expect(report.bySource[0]?.costExact).toBe(false);
  });

  it('groups sub-turn spans under their owning turn (the turn whose usage-summary follows them)', () => {
    const report = summarizeUsageBySource({
      id: 'sess-trace',
      history: [
        spanEntry('read', 5),
        spanEntry('grep', 7),
        usageEntry(100, { costUsd: 0.01 }), // turn 0 boundary → owns read+grep
        spanEntry('edit', 3),
        usageEntry(120, { costUsd: 0.012 }), // turn 1 boundary → owns edit
        spanEntry('build', 40), // in-progress turn (no usage summary yet)
      ],
    });

    expect(report.timeline).toHaveLength(3);

    expect(report.timeline[0]).toMatchObject({ turnIndex: 0, totalDurationMs: 12 });
    expect(report.timeline[0]?.spans.map((s) => s.op)).toEqual(['read', 'grep']);

    expect(report.timeline[1]).toMatchObject({ turnIndex: 1, totalDurationMs: 3 });
    expect(report.timeline[1]?.spans.map((s) => s.op)).toEqual(['edit']);

    // trailing in-progress turn
    expect(report.timeline[2]?.spans.map((s) => s.op)).toEqual(['build']);
  });

  it('produces an empty timeline when the session has no span entries', () => {
    const report = summarizeUsageBySource({
      id: 'sess-nospan',
      history: [usageEntry(100, { costUsd: 0.01 })],
    });
    expect(report.timeline).toEqual([]);
  });
});

describe('SELFHOST-004 TC-03 — analytics stays a pure read-model (no cap enforcement)', () => {
  it('never throws / halts on an arbitrarily large accumulated cost (pure read-model)', () => {
    const report = summarizeUsageBySource({
      id: 'sess-huge',
      history: [usageEntry(1_000_000, { costUsd: 9_999.99 })],
    });
    expect(report.costUsd).toBeCloseTo(9_999.99, 2);
  });

  it('the reducer source imports no runtime plugin and enforces no budget (placement)', () => {
    const source = readFileSync(new URL('../usage.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('@robota-sdk/agent-plugin');
    // no enforcement authority here — the cap lives in LimitsPlugin (P4), not this reducer
    expect(source.toLowerCase()).not.toContain('limitsplugin');
    expect(source).not.toMatch(/throw new .*budget/i);
  });
});
