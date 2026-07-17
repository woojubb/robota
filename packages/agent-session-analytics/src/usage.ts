/**
 * ANALYTICS-001: source-attributed token-usage analysis over a session record.
 *
 * The main session history records one `usage-summary` history entry per turn (an `IUsageSnapshot`,
 * created in agent-framework). This reducer aggregates those snapshots into a per-source breakdown —
 * answering "which part of the session burned the most tokens?" — so it can be reported to the user
 * and asserted by the testing framework (budget gates). Pure: no I/O, no process concerns.
 */

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  ISpanEntry,
  IUsageSnapshot,
  IUsageSource,
} from '@robota-sdk/agent-interface-transport';

/** The `type` of the per-turn usage history entry (agent-framework `createUsageSummaryEntry`). */
const USAGE_SUMMARY_ENTRY_TYPE = 'usage-summary';

/** The `type` of the per-operation span history entry (agent-framework `createSpanEntry`). */
const SPAN_ENTRY_TYPE = 'span';

/** SSOT-derived projection the usage reducer reads. */
export type TUsageAnalysisInput = Pick<IInteractiveSessionRecord, 'id' | 'history'>;

/** The main thread is the implicit source when a usage snapshot carries none. */
const MAIN_THREAD_SOURCE: IUsageSource = { scope: 'main', label: 'main thread' };

export interface IUsageSourceTotals {
  /** Stable grouping key (`<scope>:<id>`). */
  key: string;
  source: IUsageSource;
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** How many usage snapshots (turns) were attributed to this source. */
  turns: number;
  /** Share of the session's total tokens, 0–100 (rounded to 1 decimal). */
  percentage: number;
  /**
   * SELFHOST-004: exact cost (USD) attributed to this source, summed from each turn's
   * `IUsageSnapshot.costUsd` (present iff that turn's model was priced). Turns on unpriced models
   * contribute 0; `costExact` records whether EVERY contributing turn was priced.
   */
  costUsd: number;
  /** Whether every turn attributed to this source carried an exact `costUsd`. */
  costExact: boolean;
}

/** SELFHOST-004: one per-operation span on the run timeline (record-side projection of a span event). */
export interface IRunTraceSpan {
  spanId: string;
  op: string;
  durationMs: number;
}

/**
 * SELFHOST-004: one turn on the run timeline, with the sub-turn spans that ran during it grouped
 * underneath (the spans recorded on `history` between this turn's boundary and the previous one).
 */
export interface IRunTraceTurn {
  /** 0-based position of this turn among the session's usage-summary turns. */
  turnIndex: number;
  /** The source that owns this turn (from the turn's usage snapshot; main thread when unattributed). */
  source: IUsageSource;
  label: string;
  /** Spans that ran during this turn, in timeline order. */
  spans: IRunTraceSpan[];
  /** Sum of the turn's span durations, in milliseconds. */
  totalDurationMs: number;
}

export interface IUsageBySourceReport {
  sessionId: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** SELFHOST-004: exact total cost (USD) across all priced turns in the session. */
  costUsd: number;
  /** Whether every turn in the session carried an exact `costUsd` (no unpriced turns). */
  costExact: boolean;
  /** Per-source totals, sorted by `totalTokens` descending. */
  bySource: IUsageSourceTotals[];
  /** The single biggest token consumer, if any usage was recorded. */
  topConsumer?: IUsageSourceTotals;
  /**
   * SELFHOST-004: the span timeline — one entry per turn, sub-turn spans grouped under their owning
   * turn (in session order). A trailing turn (no usage summary yet) groups spans of an in-progress turn.
   */
  timeline: IRunTraceTurn[];
}

function sourceKey(source: IUsageSource): string {
  return `${source.scope}:${source.id ?? ''}`;
}

function sourceLabel(source: IUsageSource): string {
  return source.label ?? (source.id ? `${source.scope} ${source.id}` : source.scope);
}

function isUsageSummaryEntry(entry: IHistoryEntry): entry is IHistoryEntry<IUsageSnapshot> {
  return (
    entry.type === USAGE_SUMMARY_ENTRY_TYPE && typeof entry.data === 'object' && entry.data !== null
  );
}

function isSpanEntry(entry: IHistoryEntry): entry is IHistoryEntry<ISpanEntry> {
  if (entry.type !== SPAN_ENTRY_TYPE || typeof entry.data !== 'object' || entry.data === null) {
    return false;
  }
  const data = entry.data as Partial<ISpanEntry>;
  return (
    typeof data.spanId === 'string' &&
    typeof data.op === 'string' &&
    typeof data.durationMs === 'number'
  );
}

function roundPercentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Aggregate a session's `usage-summary` entries into a per-source token+cost breakdown AND assemble
 * the per-operation span timeline (SELFHOST-004).
 *
 * Token/cost: usage snapshots with no `source` are attributed to the main thread; sources are grouped
 * by `<scope>:<id>` and sorted by total tokens descending with the top consumer surfaced. Cost sums
 * each turn's exact `IUsageSnapshot.costUsd` (unpriced turns contribute 0 and clear `costExact`).
 *
 * Timeline: history is a chronological timeline where each turn ends with its `usage-summary` entry,
 * so the `span` entries that appear before a given usage-summary are the sub-turn spans of THAT turn.
 * The reducer walks in order, buffering spans, and flushes the buffer as the turn's spans at each
 * usage-summary boundary — grouping sub-turn spans under their owning turn. Spans after the last
 * usage-summary (an in-progress turn) form a trailing timeline entry. Pure: no I/O, stays within the
 * `agent-core` + `agent-interface-transport` deps (NO `agent-plugin` read — enforcement lives elsewhere).
 */
export function summarizeUsageBySource(input: TUsageAnalysisInput): IUsageBySourceReport {
  const totalsByKey = new Map<string, IUsageSourceTotals>();
  let sessionPrompt = 0;
  let sessionCompletion = 0;
  let sessionTotal = 0;
  let sessionCost = 0;
  let sessionCostExact = true;

  const timeline: IRunTraceTurn[] = [];
  let pendingSpans: IRunTraceSpan[] = [];

  const flushTurn = (source: IUsageSource): void => {
    if (pendingSpans.length === 0) return;
    timeline.push({
      turnIndex: timeline.length,
      source,
      label: sourceLabel(source),
      spans: pendingSpans,
      totalDurationMs: pendingSpans.reduce((sum, span) => sum + span.durationMs, 0),
    });
    pendingSpans = [];
  };

  for (const entry of input.history ?? []) {
    if (isSpanEntry(entry)) {
      const span = entry.data as ISpanEntry;
      pendingSpans.push({ spanId: span.spanId, op: span.op, durationMs: span.durationMs });
      continue;
    }
    if (!isUsageSummaryEntry(entry)) continue;

    const snapshot = entry.data as IUsageSnapshot;
    const source = snapshot.source ?? MAIN_THREAD_SOURCE;
    const key = sourceKey(source);
    const prompt = snapshot.promptTokens ?? 0;
    const completion = snapshot.completionTokens ?? 0;
    const total = snapshot.totalTokens;
    // Exact cost only: a priced turn carries costUsd (costStatus !== 'unknown'); unpriced turns
    // contribute 0 and mark the aggregate inexact. Never re-derives cost (single SSOT path, TC-04).
    const turnCost = snapshot.costUsd ?? 0;
    const turnPriced = snapshot.costUsd !== undefined;

    sessionPrompt += prompt;
    sessionCompletion += completion;
    sessionTotal += total;
    sessionCost += turnCost;
    if (!turnPriced) sessionCostExact = false;

    const existing = totalsByKey.get(key);
    if (existing) {
      existing.promptTokens += prompt;
      existing.completionTokens += completion;
      existing.totalTokens += total;
      existing.turns += 1;
      existing.costUsd += turnCost;
      if (!turnPriced) existing.costExact = false;
    } else {
      totalsByKey.set(key, {
        key,
        source,
        label: sourceLabel(source),
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: total,
        turns: 1,
        percentage: 0,
        costUsd: turnCost,
        costExact: turnPriced,
      });
    }

    // The usage-summary marks the turn boundary: the buffered spans belong to THIS turn.
    flushTurn(source);
  }

  // Spans of an in-progress turn (no usage summary yet) form a trailing timeline entry.
  flushTurn(MAIN_THREAD_SOURCE);

  const bySource = [...totalsByKey.values()]
    .map((totals) => ({ ...totals, percentage: roundPercentage(totals.totalTokens, sessionTotal) }))
    .sort((left, right) => right.totalTokens - left.totalTokens);

  return {
    sessionId: input.id,
    totalTokens: sessionTotal,
    promptTokens: sessionPrompt,
    completionTokens: sessionCompletion,
    costUsd: sessionCost,
    costExact: sessionCostExact,
    bySource,
    ...(bySource[0] ? { topConsumer: bySource[0] } : {}),
    timeline,
  };
}
