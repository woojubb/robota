/**
 * Unit tests for the session timing reporter (ported from agent-cli OBS-001 reporter tests).
 */

import { describe, it, expect } from 'vitest';

import { formatAggregateReport, formatSingleSession } from '../report.js';
import type { IAggregateReport, ISessionTimingReport } from '../types.js';

function makeReport(overrides: Partial<ISessionTimingReport> = {}): ISessionTimingReport {
  return {
    sessionId: 'session_test_001',
    cwd: '/tmp/project',
    createdAt: '2026-04-30T10:00:00.000Z',
    totalIntervals: 0,
    intervals: [],
    slowIntervals: [],
    stats: {
      llmWaitMs: { avg: 0, max: 0, total: 0, count: 0 },
      toolExecMs: { avg: 0, max: 0, median: 0, count: 0 },
      userToAssistantMs: { avg: 0, max: 0, count: 0 },
    },
    ...overrides,
  };
}

describe('formatSingleSession', () => {
  it('TC-05: shows slow intervals section when intervals >= 10s exist', () => {
    const report = makeReport({
      slowIntervals: [
        {
          kind: 'user_to_first_tool',
          fromType: 'user',
          toType: 'tool-start',
          fromTimestamp: '2026-04-30T10:00:00Z',
          toTimestamp: '2026-04-30T10:00:11Z',
          durationMs: 11_000,
          turnIndex: 2,
        },
      ],
    });
    const output = formatSingleSession(report);
    expect(output).toContain('Slow intervals');
    expect(output).toContain('11.0s');
    expect(output).toContain('turn 2');
  });

  it('omits slow intervals section when none exist', () => {
    expect(formatSingleSession(makeReport())).not.toContain('Slow intervals');
  });

  it('includes session ID in output', () => {
    expect(formatSingleSession(makeReport())).toContain('session_test_001');
  });

  it('shows LLM wait stats when present', () => {
    const output = formatSingleSession(
      makeReport({
        stats: {
          llmWaitMs: { avg: 23_400, max: 45_000, total: 46_800, count: 2 },
          toolExecMs: { avg: 0, max: 0, median: 0, count: 0 },
          userToAssistantMs: { avg: 0, max: 0, count: 0 },
        },
      }),
    );
    expect(output).toContain('LLM API wait');
    expect(output).toContain('23.4s');
  });

  it('shows tool exec stats when present', () => {
    const output = formatSingleSession(
      makeReport({
        stats: {
          llmWaitMs: { avg: 0, max: 0, total: 0, count: 0 },
          toolExecMs: { avg: 15, max: 120, median: 15, count: 5 },
          userToAssistantMs: { avg: 0, max: 0, count: 0 },
        },
      }),
    );
    expect(output).toContain('Tool execution');
    expect(output).toContain('15ms');
  });

  it('shows verdict line', () => {
    expect(formatSingleSession(makeReport())).toContain('Verdict');
  });
});

describe('formatAggregateReport', () => {
  it('includes session count and headline metrics', () => {
    const aggregate: IAggregateReport = {
      sessionCount: 30,
      fromDate: '2026-04-01T00:00:00Z',
      toDate: '2026-04-30T00:00:00Z',
      avgLlmResponseMs: 23_000,
      avgToolExecMs: 15,
      maxSingleDelayMs: 76_000,
      maxSingleDelaySession: 'session_abc',
      maxSingleDelayTurn: 5,
      maxSingleDelayKind: 'llm_final_response',
    };
    const output = formatAggregateReport(aggregate);
    expect(output).toContain('30 sessions');
    expect(output).toContain('23.0s');
    expect(output).toContain('15ms');
    expect(output).toContain('76.0s');
    expect(output).toContain('session_abc');
  });
});
