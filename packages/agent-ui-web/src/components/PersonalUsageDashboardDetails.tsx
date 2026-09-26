import type { Dispatch, SetStateAction } from 'react';
import type {
  TPersonalUsageDimension,
  TPersonalUsageDashboardState,
  TPersonalUsageReport,
  TUsageBreakdown,
} from './personal-usage-dashboard-types.js';

const number = new Intl.NumberFormat('en-US');
const PERCENT = 100;

function breakdownLabel(value: TUsageBreakdown): string {
  return value === 'activity' ? 'Activity' : `By ${value}`;
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  /** A qualifier shown beside the label, e.g. that a cost is estimated. */
  note?: string;
}): React.ReactElement {
  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="flex items-baseline gap-1.5 text-[13px] text-muted-foreground">
        {label}
        {note ? <span className="text-subtle">· {note}</span> : null}
      </div>
      <div className="mt-1.5 text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-foreground">
        {value}
      </div>
    </div>
  );
}

function dimensionsFor(
  report: TPersonalUsageReport,
  breakdown: TUsageBreakdown,
): readonly TPersonalUsageDimension[] {
  if (breakdown === 'model') return report.byModel;
  if (breakdown === 'provider') return report.byProvider;
  if (breakdown === 'surface') return report.bySurface;
  if (breakdown === 'source') return report.bySource;
  return [];
}

export function BreakdownPanel({
  state,
  report,
  breakdown,
  setBreakdown,
}: {
  state: TPersonalUsageDashboardState;
  report: TPersonalUsageReport;
  breakdown: TUsageBreakdown;
  setBreakdown: Dispatch<SetStateAction<TUsageBreakdown>>;
}): React.ReactElement {
  return (
    <section className="rounded-2xl bg-card p-5">
      <BreakdownHeader breakdown={breakdown} setBreakdown={setBreakdown} />
      <div className="mt-4 space-y-3">
        {breakdown === 'activity' ? (
          <ActivityRows report={report} />
        ) : (
          <DimensionRows
            report={report}
            dimensions={dimensionsFor(report, breakdown)}
            requestStoredSessionUsage={state.requestStoredSessionUsage}
          />
        )}
      </div>
    </section>
  );
}

function BreakdownHeader({
  breakdown,
  setBreakdown,
}: {
  breakdown: TUsageBreakdown;
  setBreakdown: Dispatch<SetStateAction<TUsageBreakdown>>;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold">Breakdown</h2>
      <div className="flex flex-wrap gap-1">
        {(['model', 'provider', 'surface', 'source', 'activity'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={breakdown === value}
            onClick={() => setBreakdown(value)}
            className={`rounded-lg px-2.5 py-1 text-[13px] font-medium ${
              breakdown === value
                ? 'bg-raised text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {breakdownLabel(value)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivityRows({ report }: { report: TPersonalUsageReport }): React.ReactElement {
  return (
    <>
      {report.byActivity.map((activity) => (
        <div
          key={activity.key}
          className="flex items-center justify-between gap-3 rounded-xl bg-raised/60 px-3.5 py-2.5"
        >
          <div className="min-w-0">
            <span className="truncate text-[14px] text-foreground">{activity.label}</span>
            <span className="ml-2 text-[12px] text-subtle">{activity.kind}</span>
          </div>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {number.format(activity.count)} calls
          </span>
        </div>
      ))}
    </>
  );
}

function DimensionRows({
  report,
  dimensions,
  requestStoredSessionUsage,
}: {
  report: TPersonalUsageReport;
  dimensions: readonly TPersonalUsageDimension[];
  requestStoredSessionUsage: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <>
      {dimensions.map((dimension) => (
        <div key={dimension.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <DimensionSummary report={report} dimension={dimension} />
          <span className="self-start text-[13px] tabular-nums text-subtle">
            {number.format(dimension.turns)} turns
          </span>
          <SessionButtons
            dimension={dimension}
            requestStoredSessionUsage={requestStoredSessionUsage}
          />
        </div>
      ))}
    </>
  );
}

function DimensionSummary({
  report,
  dimension,
}: {
  report: TPersonalUsageReport;
  dimension: TPersonalUsageDimension;
}): React.ReactElement {
  const width =
    report.totals.totalTokens === 0
      ? 0
      : (dimension.totalTokens / report.totals.totalTokens) * PERCENT;
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-3 text-[14px]">
        <span className="truncate text-foreground">{dimension.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {number.format(dimension.totalTokens)} tokens
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent/80" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SessionButtons({
  dimension,
  requestStoredSessionUsage,
}: {
  dimension: TPersonalUsageDimension;
  requestStoredSessionUsage: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <div className="col-span-2 flex flex-wrap gap-1">
      {dimension.sessionIds.map((sessionId) => (
        <button
          key={sessionId}
          type="button"
          onClick={() => requestStoredSessionUsage(sessionId)}
          aria-label={`Open session ${sessionId}`}
          className="rounded-md bg-raised px-2 py-1 font-mono text-[12px] text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          {sessionId}
        </button>
      ))}
    </div>
  );
}

export function StoredSessionPanel({
  state,
}: {
  state: TPersonalUsageDashboardState;
}): React.ReactElement | null {
  if (state.storedSessionUsageStatus === 'idle') return null;
  return (
    <section className="rounded-2xl bg-card p-5" aria-label="Session usage detail">
      <h2 className="text-[15px] font-semibold">
        Session {state.storedSessionUsageSessionId ?? ''}
      </h2>
      <StoredSessionContent state={state} />
    </section>
  );
}

function StoredSessionContent({
  state,
}: {
  state: TPersonalUsageDashboardState;
}): React.ReactElement | null {
  if (state.storedSessionUsageStatus === 'loading') {
    return <p className="mt-3 text-[14px] text-muted-foreground">Loading trace…</p>;
  }
  if (state.storedSessionUsageStatus === 'error') {
    return (
      <p className="mt-3 text-[14px] text-destructive">
        {state.storedSessionUsageError ?? 'Session usage failed.'}
      </p>
    );
  }
  const report = state.storedSessionUsageReport;
  if (!report) return null;
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <Stat label="Session tokens" value={number.format(report.totalTokens)} />
      <Stat label="Sources" value={number.format(report.bySource.length)} />
      <Stat label="Trace turns" value={number.format(report.timeline.length)} />
    </div>
  );
}

export function CoverageNote({
  report,
}: {
  report: TPersonalUsageReport;
}): React.ReactElement | null {
  const { coverage } = report;
  if (
    coverage.corruptSessions === 0 &&
    coverage.unsupportedSessions === 0 &&
    coverage.legacyObservations === 0
  ) {
    return null;
  }
  return (
    <p className="rounded-xl bg-warning/10 px-4 py-3 text-[13px] leading-relaxed text-warning">
      Coverage: {coverage.legacyObservations} legacy observations, {coverage.corruptSessions}{' '}
      corrupt sessions, {coverage.unsupportedSessions} unsupported sessions.
    </p>
  );
}
