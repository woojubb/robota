import {
  BreakdownPanel,
  CoverageNote,
  Stat,
  StoredSessionPanel,
} from './PersonalUsageDashboardDetails.js';

import type { Dispatch, SetStateAction } from 'react';
import type {
  TPersonalUsageDashboardState,
  TPersonalUsageReport,
  TUsageBreakdown,
} from './personal-usage-dashboard-types.js';

const number = new Intl.NumberFormat('en-US');
const PERCENT = 100;
const MINIMUM_BAR_PERCENT = 2;
const MONTH_DAY_OFFSET = 'YYYY-'.length;
const COST_DECIMAL_PLACES = 2;

function StatusPanel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-64 items-center justify-center rounded-2xl border border-border/70 bg-card/35 px-8 text-center font-mono text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function UsageHeader({
  period,
  setPeriod,
  requestCurrentSessionUsage,
}: {
  period: '7d' | '30d';
  setPeriod: Dispatch<SetStateAction<'7d' | '30d'>>;
  requestCurrentSessionUsage: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary/70">
          Local analytics
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Personal usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-session activity grouped by local calendar day.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={requestCurrentSessionUsage}
          className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 font-mono text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary"
        >
          Current session trace
        </button>
        <PeriodPicker period={period} setPeriod={setPeriod} />
      </div>
    </div>
  );
}

function PeriodPicker({
  period,
  setPeriod,
}: {
  period: '7d' | '30d';
  setPeriod: Dispatch<SetStateAction<'7d' | '30d'>>;
}): React.ReactElement {
  return (
    <div className="flex rounded-lg border border-border/70 bg-card/50 p-1">
      {(['7d', '30d'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={period === value}
          onClick={() => setPeriod(value)}
          className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${
            period === value
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {value === '7d' ? '7 days' : '30 days'}
        </button>
      ))}
    </div>
  );
}

export function CurrentSessionPanel({
  state,
}: {
  state: TPersonalUsageDashboardState;
}): React.ReactElement | null {
  if (state.currentSessionUsageStatus === 'idle') return null;
  let content: React.ReactNode = null;
  if (state.currentSessionUsageStatus === 'loading') {
    content = <p className="mt-3 font-mono text-xs text-muted-foreground">Loading trace…</p>;
  } else if (state.currentSessionUsageStatus === 'error') {
    content = <p className="mt-3 font-mono text-xs text-rose-300">Current trace unavailable.</p>;
  } else if (state.currentSessionUsageReport) {
    content = (
      <p className="mt-3 font-mono text-xs text-muted-foreground">
        {number.format(state.currentSessionUsageReport.totalTokens)} tokens ·{' '}
        {number.format(state.currentSessionUsageReport.timeline.length)} trace turns
      </p>
    );
  }
  return (
    <section
      className="rounded-2xl border border-border/70 bg-card/35 p-5"
      aria-label="Current session usage"
    >
      <h2 className="text-sm font-medium">Current session trace</h2>
      {content}
    </section>
  );
}

function UsageStats({ report }: { report: TPersonalUsageReport }): React.ReactElement {
  const cost =
    report.totals.costStatus === 'unknown'
      ? 'Unknown'
      : `$${report.totals.costUsd.toFixed(COST_DECIMAL_PLACES)}${
          report.totals.costStatus === 'estimated' ? ' estimated' : ''
        }`;
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Usage totals">
      <Stat label="Turns" value={number.format(report.totals.turns)} />
      <Stat label="Sessions" value={number.format(report.totals.sessions)} />
      <Stat label="Tokens" value={number.format(report.totals.totalTokens)} />
      <Stat label="Cost" value={cost} />
    </section>
  );
}

function DailyUsageChart({ report }: { report: TPersonalUsageReport }): React.ReactElement {
  const maxTokens = report.daily.reduce(
    (maximum, day) => Math.max(maximum, day.totals.totalTokens),
    0,
  );
  return (
    <section className="rounded-2xl border border-border/70 bg-card/35 p-5">
      <DailyChartHeader report={report} />
      <div
        className="mt-5 flex h-44 items-end gap-1.5"
        role="img"
        aria-label="Daily token usage chart"
      >
        {report.daily.map((day) => {
          const height =
            maxTokens === 0
              ? MINIMUM_BAR_PERCENT
              : Math.max(MINIMUM_BAR_PERCENT, (day.totals.totalTokens / maxTokens) * PERCENT);
          return (
            <div
              key={day.date}
              className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
            >
              <div className="relative flex h-32 w-full items-end rounded-sm bg-background/40">
                <div
                  className="w-full rounded-sm bg-gradient-to-t from-primary/45 to-cyan-400/90 transition-opacity group-hover:opacity-80"
                  style={{ height: `${height}%` }}
                  title={`${day.date}: ${number.format(day.totals.totalTokens)} tokens`}
                />
              </div>
              <span className="truncate font-mono text-[9px] text-muted-foreground">
                {day.date.slice(MONTH_DAY_OFFSET)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DailyChartHeader({ report }: { report: TPersonalUsageReport }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium">Daily usage</h2>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {report.interval.startDate} → {report.interval.endDate} · {report.timezone}
        </p>
      </div>
      {report.daily.at(-1)?.partial ? (
        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 font-mono text-[10px] text-amber-300">
          Partial day
        </span>
      ) : null}
    </div>
  );
}

export function PersonalUsageContent({
  state,
  breakdown,
  setBreakdown,
}: {
  state: TPersonalUsageDashboardState;
  breakdown: TUsageBreakdown;
  setBreakdown: Dispatch<SetStateAction<TUsageBreakdown>>;
}): React.ReactElement {
  const report = state.personalUsageReport;
  if (state.personalUsageStatus === 'loading' && !report) {
    return <StatusPanel>Loading local usage…</StatusPanel>;
  }
  if (state.personalUsageStatus === 'error') {
    return <StatusPanel>{state.personalUsageError ?? 'Usage report failed.'}</StatusPanel>;
  }
  if (!report || isEmptyReport(report)) {
    return <StatusPanel>No recorded usage in this period.</StatusPanel>;
  }
  return (
    <>
      <UsageStats report={report} />
      <DailyUsageChart report={report} />
      <BreakdownPanel
        state={state}
        report={report}
        breakdown={breakdown}
        setBreakdown={setBreakdown}
      />
      <StoredSessionPanel state={state} />
      <CoverageNote report={report} />
    </>
  );
}

function isEmptyReport(report: TPersonalUsageReport): boolean {
  return (
    report.totals.sessions === 0 &&
    report.totals.totalTokens === 0 &&
    report.byActivity.length === 0
  );
}
