/**
 * SELFHOST-004 P5 (TC-05): the trace/cost view — headless CLI path. `formatUsageReport` renders the
 * assembled read-model (cost-by-source + the per-operation span timeline) as text the TUI/GUI and the
 * `session analyze` command surface. This asserts the view actually shows cost AND the grouped trace.
 */

import { describe, it, expect } from 'vitest';

import { formatUsageReport } from '../report.js';
import { summarizeUsageBySource } from '../usage.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { ISpanEntry, IUsageSnapshot } from '@robota-sdk/agent-interface-transport';

let seq = 0;
function usageEntry(total: number, costUsd?: number): IHistoryEntry<IUsageSnapshot> {
  seq += 1;
  return {
    id: `u-${seq}`,
    timestamp: new Date(1_700_000_000_000 + seq),
    category: 'event',
    type: 'usage-summary',
    data: {
      kind: 'exact',
      scope: 'turn',
      totalTokens: total,
      promptTokens: Math.round(total * 0.6),
      completionTokens: total - Math.round(total * 0.6),
      contextUsedTokens: total,
      contextMaxTokens: 200_000,
      contextUsedPercentage: 0,
      costStatus: costUsd !== undefined ? 'exact' : 'unknown',
      ...(costUsd !== undefined ? { costUsd } : {}),
    },
  };
}
function spanEntry(op: string, durationMs: number): IHistoryEntry<ISpanEntry> {
  seq += 1;
  return {
    id: `s-${seq}`,
    timestamp: new Date(1_700_000_000_000 + seq),
    category: 'event',
    type: 'span',
    data: { spanId: `span_${seq}`, op, durationMs },
  };
}

describe('SELFHOST-004 TC-05 — formatUsageReport renders cost + trace timeline', () => {
  it('shows the session cost and per-source cost', () => {
    const report = summarizeUsageBySource({
      id: 'sess-view',
      history: [usageEntry(100, 0.01), usageEntry(200, 0.02)],
    });
    const text = formatUsageReport(report);

    expect(text).toContain('cost $0.0300');
    expect(text).toContain('main thread');
    // per-source cost column present
    expect(text).toMatch(/main thread.*\$0\.0300/);
  });

  it('marks an inexact aggregate with ~ when a turn is unpriced', () => {
    const report = summarizeUsageBySource({
      id: 'sess-inexact',
      history: [usageEntry(100, 0.01), usageEntry(200) /* unpriced */],
    });
    expect(formatUsageReport(report)).toContain('cost ~$0.0100');
  });

  it('renders the span timeline grouped under its owning turn', () => {
    const report = summarizeUsageBySource({
      id: 'sess-trace',
      history: [spanEntry('read', 5), spanEntry('grep', 7), usageEntry(100, 0.01)],
    });
    const text = formatUsageReport(report);

    expect(text).toContain('trace (per turn, sub-turn spans):');
    expect(text).toContain('turn 0');
    expect(text).toMatch(/read\s+5ms/);
    expect(text).toMatch(/grep\s+7ms/);
    // grouped duration surfaced
    expect(text).toContain('across 2 ops');
  });
});
