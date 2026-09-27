// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CurrentSessionPanel, PersonalUsageContent } from '../PersonalUsageDashboardSections.js';

import type {
  TPersonalUsageDashboardState,
  TPersonalUsageReport,
} from '../personal-usage-dashboard-types.js';

/**
 * #3289 §4 — Personal usage shows a priced total, session names instead of raw ids, and plain
 * labels instead of internal terms. These tests exercise the presentation only: the cost-aggregation
 * fix and the report's own `sessionFirstSeen` derivation are covered in `agent-session-analytics`'s
 * own tests. The report is content-free; a session's name comes from this workspace's own local
 * session listing (the same `sessionTitle()` the sidebar uses), never from the report.
 */

afterEach(cleanup);

const totals = (overrides: Partial<TPersonalUsageReport['totals']> = {}) => ({
  sessions: 1,
  turns: 1,
  promptTokens: 30,
  completionTokens: 12,
  totalTokens: 42,
  costUsd: 0,
  costStatus: 'unknown' as const,
  ...overrides,
});

function baseReport(overrides: Partial<TPersonalUsageReport> = {}): TPersonalUsageReport {
  const report: TPersonalUsageReport = {
    schemaVersion: 1,
    generatedAt: '2026-09-26T00:00:00.000Z',
    period: '7d',
    timezone: 'UTC',
    interval: { startDate: '2026-09-20', endDate: '2026-09-26' },
    totals: totals(),
    daily: [
      { date: '2026-09-26', partial: true, totals: totals(), sessionIds: ['s1'] },
    ],
    byModel: [],
    byProvider: [],
    bySurface: [],
    bySource: [],
    byActivity: [],
    sessionIds: ['s1'],
    coverage: {
      validSessions: 1,
      corruptSessions: 0,
      unsupportedSessions: 0,
      duplicateObservations: 0,
      legacyObservations: 0,
      unknownModelObservations: 0,
      unknownProviderObservations: 0,
      unknownSurfaceObservations: 0,
      corruptSessionIds: [],
      unsupportedSessionIds: [],
    },
    ...overrides,
  };
  return report;
}

function dashboardState(
  report: TPersonalUsageReport | null,
  overrides: Partial<TPersonalUsageDashboardState> = {},
): TPersonalUsageDashboardState {
  return {
    personalUsageStatus: report ? 'ready' : 'idle',
    personalUsageReport: report,
    personalUsageError: null,
    requestPersonalUsage: () => undefined,
    storedSessionUsageStatus: 'idle',
    storedSessionUsageReport: null,
    storedSessionUsageSessionId: null,
    storedSessionUsageError: null,
    requestStoredSessionUsage: () => undefined,
    currentSessionUsageStatus: 'idle',
    currentSessionUsageReport: null,
    requestCurrentSessionUsage: () => undefined,
    sessionListing: null,
    ...overrides,
  } as unknown as TPersonalUsageDashboardState;
}

/** A minimal local session-directory listing, as this workspace's own host would send it. */
function listingWith(
  ...sessions: ReadonlyArray<{ id: string; name?: string; preview?: string }>
): NonNullable<TPersonalUsageDashboardState['sessionListing']> {
  return {
    currentSessionId: sessions[0]?.id ?? '',
    sessions: sessions.map(({ id, name, preview }) => ({
      id,
      ...(name ? { name } : {}),
      cwd: '/workspace',
      updatedAt: '2026-09-26T00:00:00.000Z',
      messageCount: 0,
      preview: preview ?? '',
    })),
    unreadableSessionIds: [],
  } as unknown as NonNullable<TPersonalUsageDashboardState['sessionListing']>;
}

describe('cost: a priced total with a plain note about what was left out', () => {
  it('shows the dollar total and marks it estimated, with no "unpriced turns" note when nothing was excluded', () => {
    const report = baseReport({ totals: totals({ costUsd: 1.25, costStatus: 'estimated' }) });
    const { container } = render(
      <PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />,
    );

    expect(screen.getByText('$1.25')).toBeTruthy();
    // The "estimated" qualifier sits beside the "Cost" label as "· estimated" in one span.
    expect(container.textContent).toContain('· estimated');
    expect(screen.queryByText(/without a price/)).toBeNull();
  });

  it('shows a short note only when some usage was excluded from the total', () => {
    const report = baseReport({
      totals: totals({ costUsd: 1.25, costStatus: 'estimated', unpricedTurns: 2 }),
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />);

    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('2 turns without a price are not included.')).toBeTruthy();
  });

  it('shows Unknown, not a dollar figure, only when nothing at all could be priced', () => {
    const report = baseReport({ totals: totals({ costUsd: 0, costStatus: 'unknown' }) });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />);

    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByText(/without a price/)).toBeNull();
  });
});

describe('session buttons and the stored-session panel show names, never raw ids', () => {
  function reportWithSession(overrides: Partial<TPersonalUsageReport> = {}) {
    return baseReport({
      totals: totals({ costUsd: 1.25, costStatus: 'estimated' }),
      byModel: [
        {
          key: 'scripted-model',
          label: 'scripted-model',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 1.25,
          costStatus: 'estimated',
          sessionIds: ['session_15f05245-abc'],
        },
      ],
      sessionIds: ['session_15f05245-abc'],
      ...overrides,
    });
  }

  it('shows this workspace\'s own local listing name on the button, and the raw id only as a data attribute', () => {
    const report = reportWithSession();
    const state = dashboardState(report, {
      sessionListing: listingWith({ id: 'session_15f05245-abc', name: 'Fix the login bug' }),
    });
    render(<PersonalUsageContent state={state} breakdown="model" setBreakdown={() => undefined} />);

    const button = screen.getByRole('button', { name: 'Open session Fix the login bug' });
    expect(button.textContent).toContain('Fix the login bug');
    expect(button.getAttribute('data-session-id')).toBe('session_15f05245-abc');
    expect(screen.queryByText('session_15f05245-abc')).toBeNull();
  });

  it('falls back to "Another session" (never the raw id) when a session is outside this workspace\'s listing and the report has no first-seen time for it', () => {
    const report = baseReport({
      byModel: [
        {
          key: 'scripted-model',
          label: 'scripted-model',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0,
          costStatus: 'unknown',
          sessionIds: ['session_untracked'],
        },
      ],
      sessionIds: ['session_untracked'],
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Open session Another session' })).toBeTruthy();
    expect(screen.queryByText('session_untracked')).toBeNull();
  });

  it('falls back to "Session from <date>" (never the raw id) for a session outside the listing that has a content-free first-seen time', () => {
    const report = baseReport({
      byModel: [
        {
          key: 'scripted-model',
          label: 'scripted-model',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0,
          costStatus: 'unknown',
          sessionIds: ['session_elsewhere'],
        },
      ],
      sessionIds: ['session_elsewhere'],
      sessionFirstSeen: { session_elsewhere: '2026-09-01T12:00:00.000Z' },
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />);

    const button = screen.getByRole('button', { name: /^Open session Session from / });
    expect(button.textContent).toContain('Session from');
    expect(screen.queryByText('session_elsewhere')).toBeNull();
  });

  it('shows the session title as the stored-session panel heading, not "Session <id>"', () => {
    const report = reportWithSession();
    const state = dashboardState(report, {
      sessionListing: listingWith({ id: 'session_15f05245-abc', name: 'Fix the login bug' }),
      storedSessionUsageStatus: 'ready',
      storedSessionUsageSessionId: 'session_15f05245-abc',
      storedSessionUsageReport: {
        sessionId: 'session_15f05245-abc',
        totalTokens: 42,
        promptTokens: 30,
        completionTokens: 12,
        costUsd: 1.25,
        costExact: false,
        bySource: [],
        timeline: [],
      } as unknown as TPersonalUsageDashboardState['storedSessionUsageReport'],
    });
    render(<PersonalUsageContent state={state} breakdown="model" setBreakdown={() => undefined} />);

    const region = screen.getByRole('region', { name: 'Session usage detail' });
    expect(within(region).getByRole('heading', { name: 'Fix the login bug' })).toBeTruthy();
    expect(within(region).queryByText(/session_15f05245-abc/)).toBeNull();
  });
});

describe('breakdown tabs and surface labels', () => {
  it('hides a breakdown tab whose usage is entirely one "unknown" bucket', () => {
    const report = baseReport({
      byModel: [
        {
          key: 'scripted-model',
          label: 'scripted-model',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0,
          costStatus: 'unknown',
          sessionIds: [],
        },
      ],
      byProvider: [
        {
          key: 'unknown',
          label: 'unknown',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0,
          costStatus: 'unknown',
          sessionIds: [],
        },
      ],
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />);

    expect(screen.getByRole('button', { name: 'By model' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'By provider' })).toBeNull();
  });

  it('labels surface keys in plain words: cli -> Terminal, remote -> App or browser, others title-cased', () => {
    const dimension = (key: string) => ({
      key,
      label: key,
      turns: 1,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      costUsd: 0,
      costStatus: 'unknown' as const,
      sessionIds: [],
    });
    const report = baseReport({
      bySurface: [dimension('cli'), dimension('remote'), dimension('desktop-app')],
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="surface" setBreakdown={() => undefined} />);

    expect(screen.getByText('Terminal')).toBeTruthy();
    expect(screen.getByText('App or browser')).toBeTruthy();
    expect(screen.getByText('Desktop App')).toBeTruthy();
    expect(screen.queryByText('cli')).toBeNull();
    expect(screen.queryByText('remote')).toBeNull();
  });
});

describe('activity rows never run a tool name and its kind together', () => {
  it('keeps a real space between the activity label and its kind badge', () => {
    const report = baseReport({
      byActivity: [{ key: 'tool:Shell', label: 'Shell', kind: 'tool', count: 3 }],
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="activity" setBreakdown={() => undefined} />);

    const row = screen.getByText('Shell').closest('div')!;
    expect(row.textContent).toMatch(/Shell\s+tool/);
    expect(row.textContent).not.toContain('Shelltool');
    expect(screen.getByText('tool')).toBeTruthy();
  });
});

describe('coverage note: plain sentences, only for what was actually excluded', () => {
  it('says nothing when nothing was excluded', () => {
    render(
      <PersonalUsageContent
        state={dashboardState(baseReport({ totals: totals({ costUsd: 1, costStatus: 'estimated' }) }))}
        breakdown="model"
        setBreakdown={() => undefined}
      />,
    );
    expect(screen.queryByText(/Coverage:/)).toBeNull();
  });

  it('describes unsupported sessions in plain words, not "Coverage: N unsupported sessions"', () => {
    const report = baseReport({
      totals: totals({ costUsd: 1, costStatus: 'estimated' }),
      coverage: {
        validSessions: 1,
        corruptSessions: 0,
        unsupportedSessions: 191,
        duplicateObservations: 0,
        legacyObservations: 0,
        unknownModelObservations: 0,
        unknownProviderObservations: 0,
        unknownSurfaceObservations: 0,
        corruptSessionIds: [],
        unsupportedSessionIds: [],
      },
    });
    render(<PersonalUsageContent state={dashboardState(report)} breakdown="model" setBreakdown={() => undefined} />);

    expect(screen.queryByText(/^Coverage:/)).toBeNull();
    expect(
      screen.getByText("191 older sessions use a format this view can't read and aren't counted."),
    ).toBeTruthy();
  });
});

describe('current-session line: plain words, and no zero-turn clutter', () => {
  function currentSessionState(totalTokens: number, timelineLength: number): TPersonalUsageDashboardState {
    return dashboardState(null, {
      currentSessionUsageStatus: 'ready',
      currentSessionUsageReport: {
        sessionId: 's1',
        totalTokens,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        costExact: false,
        bySource: [],
        timeline: Array.from({ length: timelineLength }, (_, index) => ({
          turnIndex: index,
          source: { scope: 'main' as const },
          label: 'main',
          spans: [],
          totalDurationMs: 0,
        })),
      } as unknown as TPersonalUsageDashboardState['currentSessionUsageReport'],
    });
  }

  it('says "This session: N tokens" and omits the turn count when there are none', () => {
    render(<CurrentSessionPanel state={currentSessionState(857_907, 0)} />);
    expect(screen.getByText('This session: 857,907 tokens')).toBeTruthy();
  });

  it('includes the turn count, in plain words, when there is at least one', () => {
    render(<CurrentSessionPanel state={currentSessionState(500, 3)} />);
    expect(screen.getByText('This session: 500 tokens · 3 turns')).toBeTruthy();
  });
});
