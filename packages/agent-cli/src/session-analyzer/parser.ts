/**
 * Session log parser and timing interval calculator.
 */

import { readFileSync } from 'node:fs';

import type {
  ISessionHistoryEntry,
  ISessionRecord,
  ISessionTimingReport,
  ITimingInterval,
  ITimingStats,
  TIntervalKind,
} from './types.js';

export function parseSessionFile(filePath: string): ISessionRecord {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ISessionRecord;
}

/** Calculate gap in milliseconds between two ISO 8601 timestamps. */
export function gapMs(from: string, to: string): number {
  return new Date(to).getTime() - new Date(from).getTime();
}

/**
 * Compute timing intervals from a history entry array.
 *
 * Strategy: scan the timeline turn by turn.
 * A "turn" starts with a user message. After user, we expect:
 *   - zero or more: tool-start → tool-end cycles
 *   - optionally: tool-summary
 *   - finally: assistant message
 */
export function computeTimingIntervals(history: ISessionHistoryEntry[]): ITimingInterval[] {
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
      let lastToolEndTs: string | null = null;
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

function makeInterval(
  kind: TIntervalKind,
  fromType: string,
  toType: string,
  fromTimestamp: string,
  toTimestamp: string,
  turnIndex: number,
): ITimingInterval {
  return {
    kind,
    fromType,
    toType,
    fromTimestamp,
    toTimestamp,
    durationMs: gapMs(fromTimestamp, toTimestamp),
    turnIndex,
  };
}

const SLOW_THRESHOLD_MS = 10_000;

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

  const avg = (arr: ITimingInterval[]) =>
    arr.length ? Math.round(arr.reduce((s, iv) => s + iv.durationMs, 0) / arr.length) : 0;
  const max = (arr: ITimingInterval[]) =>
    arr.length ? Math.max(...arr.map((iv) => iv.durationMs)) : 0;
  const median = (arr: ITimingInterval[]) => {
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

export function analyzeSession(record: ISessionRecord): ISessionTimingReport {
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
