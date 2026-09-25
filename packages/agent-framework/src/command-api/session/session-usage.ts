/**
 * The session's recorded token usage, one record per usage entry, read from the history the session
 * persists: every turn's usage and every other model it consulted (the advisor) land there, so a
 * reader that totals these records totals everything the session spent.
 */

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IUsageSource } from '@robota-sdk/agent-interface-analytics';

export interface ISessionUsageRecord {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Present when the usage was priced on the model that produced it. */
  readonly costUsd?: number;
  /** Who spent it; absent for the main thread. */
  readonly source?: IUsageSource;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function readSessionUsageRecords(history: readonly IHistoryEntry[]): ISessionUsageRecord[] {
  const records: ISessionUsageRecord[] = [];
  for (const entry of history) {
    if (entry.category !== 'event' || entry.type !== 'usage-summary') continue;
    if (typeof entry.data !== 'object' || entry.data === null) continue;
    const data = entry.data as {
      promptTokens?: unknown;
      completionTokens?: unknown;
      costUsd?: unknown;
      source?: IUsageSource;
    };
    const costUsd = data.costUsd;
    records.push({
      promptTokens: count(data.promptTokens),
      completionTokens: count(data.completionTokens),
      ...(typeof costUsd === 'number' && Number.isFinite(costUsd) ? { costUsd } : {}),
      ...(data.source !== undefined ? { source: data.source } : {}),
    });
  }
  return records;
}
