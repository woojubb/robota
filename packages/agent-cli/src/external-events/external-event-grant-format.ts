import type {
  IExternalEventGrantCounters,
  IExternalEventGrantRow,
} from './external-event-grant-host.js';

function counts(values: Readonly<Record<string, number | undefined>>): string {
  const entries = Object.entries(values).filter(([, count]) => (count ?? 0) > 0);
  return entries.length === 0
    ? 'none'
    : entries.map(([key, count]) => `${key} ${count}`).join(', ');
}

function describeCounters(counters: IExternalEventGrantCounters): string {
  return `accepted ${counters.accepted}; refused: ${counts(counters.refused)}; settled: ${counts(counters.settled)}`;
}

/** One line per grant: label, principal kind, state and counts. No principal value is ever shown. */
export function formatExternalEventGrantRows(rows: readonly IExternalEventGrantRow[]): string {
  if (rows.length === 0) return 'No external event grants.\n';
  return `${rows
    .map(
      (row) =>
        `  ${row.grantId}  ${row.principal}  ${row.state}  ${describeCounters(row.counters)}`,
    )
    .join('\n')}\n`;
}
