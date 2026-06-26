/**
 * Session-log timing-interval computation and aggregation.
 *
 * Operates on canonical history entries (`IHistoryEntry`); persisted timestamps arrive as ISO
 * strings at runtime (JSON has no Date), so all timestamp math goes through `new Date(...)`.
 */

import type {
  IAggregateReport,
  TSessionAnalysisInput,
  ISessionTimingReport,
  ITimingInterval,
  ITimingStats,
  TIntervalKind,
} from './types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

const SLOW_THRESHOLD_MS = 10_000;

/** Gap in milliseconds between two timestamps (ISO string or Date). */
export function gapMs(from: string | Date, to: string | Date): number {
  return new Date(to).getTime() - new Date(from).getTime();
}

function toIso(value: string | Date): string {
  return new Date(value).toISOString();
}

function makeInterval(
  kind: TIntervalKind,
  fromType: string,
  toType: string,
  fromTimestamp: string | Date,
  toTimestamp: string | Date,
  turnIndex: number,
): ITimingInterval {
  return {
    kind,
    fromType,
    toType,
    fromTimestamp: toIso(fromTimestamp),
    toTimestamp: toIso(toTimestamp),
    durationMs: gapMs(fromTimestamp, toTimestamp),
    turnIndex,
  };
}

/**
 * Compute timing intervals from a history entry array.
 *
 * Strategy: scan the timeline turn by turn. A "turn" starts with a user message. After user, we
 * expect zero or more tool-start → tool-end cycles, optionally a tool-summary, then an assistant
 * message.
 */
export function computeTimingIntervals(history: readonly IHistoryEntry[]): ITimingInterval[] {
  const intervals: ITimingInterval[] = [];
  let turnIndex = 0;

  let i = 0;
  while (i < history.length) {
    const entry = history[i];
    if (!entry) {
      i++;
      continue;
    }

    if (entry.category === 'chat' && entry.type === 'user') {
      turnIndex++;
      const userTs = entry.timestamp;
      let foundFirstTool = false;
      let lastToolEndTs: IHistoryEntry['timestamp'] | null = null;
      let j = i + 1;

      while (j < history.length) {
        const next = history[j];
        if (!next) {
          j++;
          continue;
        }

        if (next.category === 'chat' && next.type === 'user') {
          break;
        }

        if (next.category === 'event' && next.type === 'tool-start') {
          if (!foundFirstTool) {
            intervals.push(
              makeInterval(
                'user_to_first_tool',
                'user',
                'tool-start',
                userTs,
                next.timestamp,
                turnIndex,
              ),
            );
            foundFirstTool = true;
          } else if (lastToolEndTs !== null) {
            intervals.push(
              makeInterval(
                'llm_between_tools',
                'tool-end',
                'tool-start',
                lastToolEndTs,
                next.timestamp,
                turnIndex,
              ),
            );
          }
          lastToolEndTs = null;
          j++;
          continue;
        }

        if (next.category === 'event' && next.type === 'tool-end') {
          const prev = history[j - 1];
          if (prev && prev.category === 'event' && prev.type === 'tool-start') {
            intervals.push(
              makeInterval(
                'tool_exec',
                'tool-start',
                'tool-end',
                prev.timestamp,
                next.timestamp,
                turnIndex,
              ),
            );
          }
          lastToolEndTs = next.timestamp;
          j++;
          continue;
        }

        if (next.category === 'event' && next.type === 'tool-summary') {
          if (lastToolEndTs !== null) {
            intervals.push(
              makeInterval(
                'llm_final_response',
                'tool-end',
                'tool-summary',
                lastToolEndTs,
                next.timestamp,
                turnIndex,
              ),
            );
          }
          j++;
          continue;
        }

        if (next.category === 'chat' && next.type === 'assistant') {
          if (!foundFirstTool) {
            intervals.push(
              makeInterval(
                'user_to_assistant',
                'user',
                'assistant',
                userTs,
                next.timestamp,
                turnIndex,
              ),
            );
          } else if (lastToolEndTs !== null) {
            intervals.push(
              makeInterval(
                'llm_final_response',
                'tool-end',
                'assistant',
                lastToolEndTs,
                next.timestamp,
                turnIndex,
              ),
            );
          }
          j++;
          break;
        }

        j++;
      }

      i = j;
    } else {
      i++;
    }
  }

  return intervals;
}

function computeStats(intervals: ITimingInterval[]): ITimingStats {
  const llm = intervals.filter(
    (iv) =>
      iv.kind === 'user_to_first_tool' ||
      iv.kind === 'user_to_assistant' ||
      iv.kind === 'llm_between_tools' ||
      iv.kind === 'llm_final_response',
  );
  const tool = intervals.filter((iv) => iv.kind === 'tool_exec');
  const direct = intervals.filter((iv) => iv.kind === 'user_to_assistant');

  const avg = (arr: ITimingInterval[]): number =>
    arr.length ? Math.round(arr.reduce((s, iv) => s + iv.durationMs, 0) / arr.length) : 0;
  const max = (arr: ITimingInterval[]): number =>
    arr.length ? Math.max(...arr.map((iv) => iv.durationMs)) : 0;
  const median = (arr: ITimingInterval[]): number => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a.durationMs - b.durationMs);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round(((sorted[mid - 1]?.durationMs ?? 0) + (sorted[mid]?.durationMs ?? 0)) / 2)
      : (sorted[mid]?.durationMs ?? 0);
  };

  return {
    llmWaitMs: {
      avg: avg(llm),
      max: max(llm),
      total: llm.reduce((s, iv) => s + iv.durationMs, 0),
      count: llm.length,
    },
    toolExecMs: { avg: avg(tool), max: max(tool), median: median(tool), count: tool.length },
    userToAssistantMs: { avg: avg(direct), max: max(direct), count: direct.length },
  };
}

/** Compute the timing report for a single session record. */
export function analyzeSession(record: TSessionAnalysisInput): ISessionTimingReport {
  const history = record.history ?? [];
  const intervals = computeTimingIntervals(history);
  const slowIntervals = intervals.filter((iv) => iv.durationMs >= SLOW_THRESHOLD_MS);

  return {
    sessionId: record.id,
    cwd: record.cwd,
    createdAt: record.createdAt,
    totalIntervals: intervals.length,
    intervals,
    slowIntervals,
    stats: computeStats(intervals),
  };
}

/** Aggregate multiple single-session reports into a fleet-level summary. */
export function aggregateReports(reports: readonly ISessionTimingReport[]): IAggregateReport {
  const llmIntervals = reports.flatMap((r) =>
    r.intervals.filter(
      (iv) =>
        iv.kind === 'user_to_first_tool' ||
        iv.kind === 'user_to_assistant' ||
        iv.kind === 'llm_between_tools' ||
        iv.kind === 'llm_final_response',
    ),
  );
  const toolIntervals = reports.flatMap((r) => r.intervals.filter((iv) => iv.kind === 'tool_exec'));

  const avgLlmResponseMs = llmIntervals.length
    ? Math.round(llmIntervals.reduce((s, iv) => s + iv.durationMs, 0) / llmIntervals.length)
    : 0;
  const avgToolExecMs = toolIntervals.length
    ? Math.round(toolIntervals.reduce((s, iv) => s + iv.durationMs, 0) / toolIntervals.length)
    : 0;

  let maxSingleDelayMs = 0;
  let maxSingleDelaySession = '';
  let maxSingleDelayTurn = 0;
  let maxSingleDelayKind = '';

  for (const r of reports) {
    for (const iv of r.intervals) {
      if (iv.durationMs > maxSingleDelayMs) {
        maxSingleDelayMs = iv.durationMs;
        maxSingleDelaySession = r.sessionId;
        maxSingleDelayTurn = iv.turnIndex;
        maxSingleDelayKind = iv.kind;
      }
    }
  }

  const dates = reports.map((r) => r.createdAt).sort();

  return {
    sessionCount: reports.length,
    fromDate: dates[0] ?? '',
    toDate: dates[dates.length - 1] ?? '',
    avgLlmResponseMs,
    avgToolExecMs,
    maxSingleDelayMs,
    maxSingleDelaySession,
    maxSingleDelayTurn,
    maxSingleDelayKind,
  };
}
