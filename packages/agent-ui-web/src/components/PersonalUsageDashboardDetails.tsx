import { sessionTitle } from './SessionSidebar.js';

import type { Dispatch, SetStateAction } from 'react';
import type {
  TPersonalUsageDimension,
  TPersonalUsageDashboardState,
  TPersonalUsageReport,
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

const sessionTimestampFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Never the raw id: a session this workspace's own listing knows is named from that local data (the
 * same `sessionTitle()` the sidebar uses — its `name`, else its own preview, both this person's own
 * local data already shown in this GUI). A session outside that listing (e.g. from another workspace)
 * falls back to the report's content-free first-seen timestamp, or else a plain placeholder — never to
 * the id itself.
 */
function sessionDisplayTitle(
  state: TPersonalUsageDashboardState,
  report: TPersonalUsageReport,
  sessionId: string,
): string {
  const listed = state.sessionListing?.sessions.find((session) => session.id === sessionId);
  if (listed) return sessionTitle(listed);
  const firstSeen = report.sessionFirstSeen?.[sessionId];
  const at = firstSeen ? new Date(firstSeen) : undefined;
  if (at && !Number.isNaN(at.getTime())) {
    return `Session from ${sessionTimestampFormat.format(at)}`;
  }
  return 'Another session';
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
            state={state}
            report={report}
            breakdown={active}
            dimensions={dimensionsFor(report, active)}
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
  state,
  report,
  breakdown,
  dimensions,
}: {
  state: TPersonalUsageDashboardState;
  report: TPersonalUsageReport;
  breakdown: TUsageBreakdown;
  dimensions: readonly TPersonalUsageDimension[];
}): React.ReactElement {
  return (
    <>
      {dimensions.map((dimension) => (
        <div key={dimension.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <DimensionSummary report={report} breakdown={breakdown} dimension={dimension} />
          <span className="self-start text-[13px] tabular-nums text-subtle">
            {number.format(dimension.turns)} turns
          </span>
          <SessionButtons state={state} report={report} dimension={dimension} />
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
  state,
  report,
  dimension,
}: {
  state: TPersonalUsageDashboardState;
  report: TPersonalUsageReport;
  dimension: TPersonalUsageDimension;
}): React.ReactElement {
  return (
    <div className="col-span-2 flex flex-wrap gap-1">
      {dimension.sessionIds.map((sessionId) => {
        const title = sessionDisplayTitle(state, report, sessionId);
        return (
          <button
            key={sessionId}
            type="button"
            data-session-id={sessionId}
            onClick={() => state.requestStoredSessionUsage(sessionId)}
            aria-label={`Open session ${title}`}
            className="rounded-md bg-raised px-2 py-1 text-[12px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <span className="max-w-40 truncate align-middle">{title}</span>
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
  const title = state.personalUsageReport
    ? sessionDisplayTitle(state, state.personalUsageReport, sessionId)
    : 'Another session';
  return (
    <section className="rounded-2xl bg-card p-5" aria-label="Session usage detail" data-session-id={sessionId}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
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
    const verb = coverage.unsupportedSessions === 1 ? 'uses' : 'use';
    sentences.push(
      `${number.format(coverage.unsupportedSessions)} older ${noun} ${verb} a format this view can't read and ${coverage.unsupportedSessions === 1 ? "isn't" : "aren't"} counted.`,
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
