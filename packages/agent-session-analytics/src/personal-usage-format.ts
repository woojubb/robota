import type {
  IPersonalUsageDimension,
  IPersonalUsageReport,
} from '@robota-sdk/agent-interface-analytics';

const COST_DECIMAL_PLACES = 4;

function dimensionLines(title: string, values: readonly IPersonalUsageDimension[]): string[] {
  return [
    '',
    title,
    ...(values.length === 0
      ? ['(none)']
      : values.map(
          (value) =>
            `${value.label}  ${value.turns} turns  ${value.totalTokens} tokens  cost ${value.costStatus === 'unknown' ? 'unknown' : `$${value.costUsd.toFixed(COST_DECIMAL_PLACES)}`}`,
        )),
  ];
}

/** Render the provider-neutral personal-usage report for the terminal surface. */
export function formatPersonalUsageReport(report: IPersonalUsageReport): string {
  const cost =
    report.totals.costStatus === 'unknown'
      ? 'unknown'
      : `$${report.totals.costUsd.toFixed(COST_DECIMAL_PLACES)} (${report.totals.costStatus})`;
  return [
    `Personal usage — ${report.period} (${report.timezone})`,
    `${report.interval.startDate} → ${report.interval.endDate}`,
    `Sessions ${report.totals.sessions} · Turns ${report.totals.turns} · Tokens ${report.totals.totalTokens} (${report.totals.promptTokens} input / ${report.totals.completionTokens} output) · Cost ${cost}`,
    '',
    'Daily usage',
    ...report.daily.map(
      (day) =>
        `${day.date}${day.partial ? ' (partial)' : ''}  ${day.totals.turns} turns  ${day.totals.totalTokens} tokens`,
    ),
    ...dimensionLines('By model', report.byModel),
    ...dimensionLines('By provider', report.byProvider),
    ...dimensionLines('By surface', report.bySurface),
    ...dimensionLines('By source', report.bySource),
    '',
    'Activity',
    ...(report.byActivity.length === 0
      ? ['(none)']
      : report.byActivity.map(
          (activity) => `${activity.kind}:${activity.label}  ${activity.count} calls`,
        )),
    '',
    `Coverage: legacy ${report.coverage.legacyObservations}, corrupt ${report.coverage.corruptSessions}, unsupported ${report.coverage.unsupportedSessions}, duplicates ${report.coverage.duplicateObservations}`,
    'Local estimates from recorded sessions; costs are not an invoice.',
  ].join('\n');
}
