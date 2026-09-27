import type { Dispatch, SetStateAction } from 'react';
import type {
  TPersonalUsageDimension,
  TPersonalUsageDashboardState,
  TPersonalUsageReport,
  TPersonalUsageSessionLabel,
  TUsageBreakdown,
} from './personal-usage-dashboard-types.js';

const number = new Intl.NumberFormat('en-US');
const PERCENT = 100;

/** Breakdown tabs backed by a dimension list (never "activity", which has no "unknown" bucket). */
const DIMENSION_BREAKDOWNS = ['model', 'provider', 'surface', 'source'] as const;

function breakdownLabel(value: TUsageBreakdown): string {
  return value === 'activity' ? 'Activity' : `By ${value}`;
}

/** Plain words for a surface key; anything not called out is title-cased from its raw key. */
function surfaceLabel(key: string): string {
  if (key === 'cli') return 'Terminal';
  if (key === 'remote') return 'App or browser';
  return key
    .split(/[-_]/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** A tab is hidden when every bit of its usage landed in one "we don't know" bucket. */
function isSingleUnknownBucket(dimensions: readonly TPersonalUsageDimension[]): boolean {
  return dimensions.length === 1 && dimensions[0]?.key === 'unknown';
}

function visibleBreakdowns(report: TPersonalUsageReport): readonly TUsageBreakdown[] {
  const shown = DIMENSION_BREAKDOWNS.filter(
    (value) => !isSingleUnknownBucket(dimensionsFor(report, value)),
  );
  return [...shown, 'activity'];
}

/** Never the raw id: a session outside `sessionLabels` (or the report itself) still gets a plain title. */
function sessionLabelFor(
  report: TPersonalUsageReport,
  sessionId: string,
): TPersonalUsageSessionLabel {
  return report.sessionLabels?.[sessionId] ?? { title: 'Untitled session' };
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
  const visible = visibleBreakdowns(report);
  // The tab the person picked may have just become hidden (its usage is now a single unknown bucket,
  // or was all along for a freshly loaded report) — fall back to showing the first visible tab rather
  // than an empty panel, without forcing that choice back into the person's own selection state.
  const active = visible.includes(breakdown) ? breakdown : (visible[0] ?? breakdown);
  return (
    <section className="rounded-2xl bg-card p-5">
      <BreakdownHeader breakdown={active} setBreakdown={setBreakdown} visible={visible} />
      <div className="mt-4 space-y-3">
        {active === 'activity' ? (
          <ActivityRows report={report} />
        ) : (
          <DimensionRows
            report={report}
            breakdown={active}
            dimensions={dimensionsFor(report, active)}
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
  visible,
}: {
  breakdown: TUsageBreakdown;
  setBreakdown: Dispatch<SetStateAction<TUsageBreakdown>>;
  visible: readonly TUsageBreakdown[];
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold">Breakdown</h2>
      <div className="flex flex-wrap gap-1">
        {visible.map((value) => (
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
            {/* A literal space (not just a CSS margin) so the name and its kind never read as one
                run-together word to a screen reader or a plain-text copy. */}
            {' '}
            <span className="ml-1 rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-subtle">
              {activity.kind}
            </span>
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
  breakdown,
  dimensions,
  requestStoredSessionUsage,
}: {
  report: TPersonalUsageReport;
  breakdown: TUsageBreakdown;
  dimensions: readonly TPersonalUsageDimension[];
  requestStoredSessionUsage: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <>
      {dimensions.map((dimension) => (
        <div key={dimension.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <DimensionSummary report={report} breakdown={breakdown} dimension={dimension} />
          <span className="self-start text-[13px] tabular-nums text-subtle">
            {number.format(dimension.turns)} turns
          </span>
          <SessionButtons
            report={report}
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
  breakdown,
  dimension,
}: {
  report: TPersonalUsageReport;
  breakdown: TUsageBreakdown;
  dimension: TPersonalUsageDimension;
}): React.ReactElement {
  const width =
    report.totals.totalTokens === 0
      ? 0
      : (dimension.totalTokens / report.totals.totalTokens) * PERCENT;
  const label = breakdown === 'surface' ? surfaceLabel(dimension.key) : dimension.label;
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-3 text-[14px]">
        <span className="truncate text-foreground">{label}</span>
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
  report,
  dimension,
  requestStoredSessionUsage,
}: {
  report: TPersonalUsageReport;
  dimension: TPersonalUsageDimension;
  requestStoredSessionUsage: (sessionId: string) => void;
}): React.ReactElement {
  return (
    <div className="col-span-2 flex flex-wrap gap-1">
      {dimension.sessionIds.map((sessionId) => {
        const label = sessionLabelFor(report, sessionId);
        return (
          <button
            key={sessionId}
            type="button"
            data-session-id={sessionId}
            onClick={() => requestStoredSessionUsage(sessionId)}
            aria-label={`Open session ${label.title}`}
            className="rounded-md bg-raised px-2 py-1 text-[12px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <span className="max-w-40 truncate align-middle">{label.title}</span>
            {label.workspace ? (
              <span className="ml-1 align-middle text-subtle">· {label.workspace}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function StoredSessionPanel({
  state,
}: {
  state: TPersonalUsageDashboardState;
}): React.ReactElement | null {
  if (state.storedSessionUsageStatus === 'idle') return null;
  const sessionId = state.storedSessionUsageSessionId ?? '';
  const label = state.personalUsageReport
    ? sessionLabelFor(state.personalUsageReport, sessionId)
    : { title: 'Untitled session' };
  return (
    <section className="rounded-2xl bg-card p-5" aria-label="Session usage detail" data-session-id={sessionId}>
      <h2 className="text-[15px] font-semibold">{label.title}</h2>
      {label.workspace ? <p className="text-[13px] text-subtle">{label.workspace}</p> : null}
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

/** Plain, one-per-condition sentences — shown only for what this view actually left out. */
function coverageSentences(report: TPersonalUsageReport): string[] {
  const { coverage } = report;
  const sentences: string[] = [];
  if (coverage.unsupportedSessions > 0) {
    const noun = coverage.unsupportedSessions === 1 ? 'session' : 'sessions';
    sentences.push(
      `${number.format(coverage.unsupportedSessions)} older ${noun} use a format this view can't read and ${coverage.unsupportedSessions === 1 ? "isn't" : "aren't"} counted.`,
    );
  }
  if (coverage.corruptSessions > 0) {
    const noun = coverage.corruptSessions === 1 ? 'session' : 'sessions';
    sentences.push(
      `${number.format(coverage.corruptSessions)} ${noun} couldn't be read and ${coverage.corruptSessions === 1 ? "isn't" : "aren't"} counted.`,
    );
  }
  if (coverage.legacyObservations > 0) {
    const noun = coverage.legacyObservations === 1 ? 'record' : 'records';
    sentences.push(
      `${number.format(coverage.legacyObservations)} older usage ${noun} ${coverage.legacyObservations === 1 ? "doesn't" : "don't"} have enough detail to break down, so ${coverage.legacyObservations === 1 ? 'it counts' : 'they count'} only toward the totals.`,
    );
  }
  return sentences;
}

export function CoverageNote({
  report,
}: {
  report: TPersonalUsageReport;
}): React.ReactElement | null {
  const sentences = coverageSentences(report);
  if (sentences.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-xl bg-warning/10 px-4 py-3 text-[13px] leading-relaxed text-warning">
      {sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}
