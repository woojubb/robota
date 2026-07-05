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
  IUsageSnapshot,
  IUsageSource,
} from '@robota-sdk/agent-interface-transport';

/** The `type` of the per-turn usage history entry (agent-framework `createUsageSummaryEntry`). */
const USAGE_SUMMARY_ENTRY_TYPE = 'usage-summary';

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
}

export interface IUsageBySourceReport {
  sessionId: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Per-source totals, sorted by `totalTokens` descending. */
  bySource: IUsageSourceTotals[];
  /** The single biggest token consumer, if any usage was recorded. */
  topConsumer?: IUsageSourceTotals;
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

function roundPercentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Aggregate a session's `usage-summary` entries into a per-source token breakdown.
 *
 * Usage snapshots with no `source` are attributed to the main thread. Sources are grouped by
 * `<scope>:<id>`; the result is sorted by total tokens descending with the top consumer surfaced.
 */
export function summarizeUsageBySource(input: TUsageAnalysisInput): IUsageBySourceReport {
  const totalsByKey = new Map<string, IUsageSourceTotals>();
  let sessionPrompt = 0;
  let sessionCompletion = 0;
  let sessionTotal = 0;

  for (const entry of input.history ?? []) {
    if (!isUsageSummaryEntry(entry)) continue;
    const snapshot = entry.data as IUsageSnapshot;
    const source = snapshot.source ?? MAIN_THREAD_SOURCE;
    const key = sourceKey(source);
    const prompt = snapshot.promptTokens ?? 0;
    const completion = snapshot.completionTokens ?? 0;
    const total = snapshot.totalTokens;

    sessionPrompt += prompt;
    sessionCompletion += completion;
    sessionTotal += total;

    const existing = totalsByKey.get(key);
    if (existing) {
      existing.promptTokens += prompt;
      existing.completionTokens += completion;
      existing.totalTokens += total;
      existing.turns += 1;
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
      });
    }
  }

  const bySource = [...totalsByKey.values()]
    .map((totals) => ({ ...totals, percentage: roundPercentage(totals.totalTokens, sessionTotal) }))
    .sort((left, right) => right.totalTokens - left.totalTokens);

  return {
    sessionId: input.id,
    totalTokens: sessionTotal,
    promptTokens: sessionPrompt,
    completionTokens: sessionCompletion,
    bySource,
    ...(bySource[0] ? { topConsumer: bySource[0] } : {}),
  };
}
