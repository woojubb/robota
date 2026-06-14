/**
 * Unit tests for session-log timing analysis (ported from agent-cli OBS-001 parser tests).
 */

import { describe, it, expect } from 'vitest';

import { analyzeSession, computeTimingIntervals, gapMs } from '../analyze.js';
import type { ISessionAnalysisInput } from '../types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';

function ts(offsetMs: number): Date {
  return new Date(1_700_000_000_000 + offsetMs);
}

function entry(
  type: string,
  offsetMs: number,
  category: 'chat' | 'event' = 'event',
): IHistoryEntry {
  return { id: `e-${offsetMs}`, timestamp: ts(offsetMs), category, type };
}

// TC-03: timestamp diff calculation is accurate
describe('gapMs', () => {
  it('TC-03: computes gap correctly between ISO 8601 timestamps', () => {
    expect(gapMs('2026-04-30T10:00:00.000Z', '2026-04-30T10:00:23.400Z')).toBe(23_400);
  });

  it('returns 0 for identical timestamps', () => {
    const t = '2026-04-30T10:00:00.000Z';
    expect(gapMs(t, t)).toBe(0);
  });

  it('handles sub-second precision', () => {
    expect(gapMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.015Z')).toBe(15);
  });

  it('handles Date inputs as well as ISO strings', () => {
    expect(gapMs(new Date(1_000), new Date(4_000))).toBe(3_000);
  });
});

// TC-04: interval kind classification
describe('computeTimingIntervals', () => {
  it('TC-04a: classifies user→assistant interval as user_to_assistant', () => {
    const intervals = computeTimingIntervals([
      entry('user', 0, 'chat'),
      entry('assistant', 5_000, 'chat'),
    ]);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.kind).toBe('user_to_assistant');
    expect(intervals[0]?.durationMs).toBe(5_000);
  });

  it('TC-04b: classifies tool-start→tool-end as tool_exec (code processing)', () => {
    const intervals = computeTimingIntervals([
      entry('user', 0, 'chat'),
      entry('tool-start', 3_000),
      entry('tool-end', 3_015),
      entry('tool-summary', 25_000),
      entry('assistant', 25_000, 'chat'),
    ]);
    const toolExec = intervals.find((iv) => iv.kind === 'tool_exec');
    expect(toolExec?.durationMs).toBe(15);
    expect(toolExec?.fromType).toBe('tool-start');
    expect(toolExec?.toType).toBe('tool-end');
  });

  it('TC-04c: classifies user→tool-start as user_to_first_tool (LLM decision time)', () => {
    const intervals = computeTimingIntervals([
      entry('user', 0, 'chat'),
      entry('tool-start', 11_000),
      entry('tool-end', 11_015),
      entry('tool-summary', 30_000),
      entry('assistant', 30_000, 'chat'),
    ]);
    expect(intervals.find((iv) => iv.kind === 'user_to_first_tool')?.durationMs).toBe(11_000);
  });

  it('TC-04d: classifies tool-end→tool-start as llm_between_tools', () => {
    const intervals = computeTimingIntervals([
      entry('user', 0, 'chat'),
      entry('tool-start', 5_000),
      entry('tool-end', 5_015),
      entry('tool-start', 10_000),
      entry('tool-end', 10_020),
      entry('tool-summary', 30_000),
      entry('assistant', 30_000, 'chat'),
    ]);
    expect(intervals.find((iv) => iv.kind === 'llm_between_tools')?.durationMs).toBe(
      10_000 - 5_015,
    );
  });

  it('TC-04e: classifies tool-end→tool-summary as llm_final_response', () => {
    const intervals = computeTimingIntervals([
      entry('user', 0, 'chat'),
      entry('tool-start', 3_000),
      entry('tool-end', 3_010),
      entry('tool-summary', 34_000),
      entry('assistant', 34_000, 'chat'),
    ]);
    expect(intervals.find((iv) => iv.kind === 'llm_final_response')?.durationMs).toBe(
      34_000 - 3_010,
    );
  });

  it('produces no intervals for empty history', () => {
    expect(computeTimingIntervals([])).toHaveLength(0);
  });

  it('assigns correct turnIndex across multiple user turns', () => {
    const intervals = computeTimingIntervals([
      entry('user', 0, 'chat'),
      entry('assistant', 5_000, 'chat'),
      entry('user', 10_000, 'chat'),
      entry('assistant', 15_000, 'chat'),
    ]);
    expect(intervals[0]?.turnIndex).toBe(1);
    expect(intervals[1]?.turnIndex).toBe(2);
  });
});

// analyzeSession integration
describe('analyzeSession', () => {
  it('returns slowIntervals for intervals >= 10s', () => {
    const record: ISessionAnalysisInput = {
      id: 'test-session',
      cwd: '/tmp',
      createdAt: ts(0).toISOString(),
      history: [entry('user', 0, 'chat'), entry('assistant', 23_000, 'chat')],
    };
    const report = analyzeSession(record);
    expect(report.sessionId).toBe('test-session');
    expect(report.slowIntervals).toHaveLength(1);
    expect(report.slowIntervals[0]?.durationMs).toBe(23_000);
  });

  it('computes stats correctly for LLM-only session', () => {
    const record: ISessionAnalysisInput = {
      id: 's2',
      cwd: '/tmp',
      createdAt: ts(0).toISOString(),
      history: [
        entry('user', 0, 'chat'),
        entry('assistant', 18_000, 'chat'),
        entry('user', 30_000, 'chat'),
        entry('assistant', 48_000, 'chat'),
      ],
    };
    const report = analyzeSession(record);
    expect(report.stats.userToAssistantMs.count).toBe(2);
    expect(report.stats.userToAssistantMs.avg).toBe(18_000);
  });
});
