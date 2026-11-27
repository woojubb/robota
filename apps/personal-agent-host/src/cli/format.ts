import type { IAccountView, IStatusReport } from '../control-plane.js';

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => pad(cell, widths[i]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function unitState(view: IAccountView): string {
  return view.runtime.state;
}

export function formatList(views: readonly IAccountView[]): string {
  if (views.length === 0) return 'No accounts.\n';
  const rows = [['ID', 'STATE', 'UNIT', 'KEY', 'URL']];
  for (const v of views) rows.push([v.id, v.state, unitState(v), v.key, v.url]);
  return `${table(rows)}\n`;
}

export function formatAccount(view: IAccountView): string {
  const provider = [view.provider.type, view.provider.model, view.provider.baseUrl]
    .filter((part) => part !== undefined)
    .join(' ');
  const lines: Array<[string, string]> = [
    ['id', view.id],
    ['url', view.url],
    ['state', view.state],
    ['unit', unitState(view)],
    ['backend', view.backend],
    ['provider', provider],
    ['key', `${view.keySource} (${view.key})`],
    ['limits', `${view.limits.memoryMb} MB, ${view.limits.cpus} CPUs, ${view.limits.pids} pids`],
    ['image', view.image],
    ['created', view.createdAt],
    ['updated', view.updatedAt],
  ];
  return `${lines.map(([name, value]) => `${pad(name, 9)}${value}`).join('\n')}\n`;
}

export function formatStatus(report: IStatusReport): string {
  const lines = [
    `backend   ${report.runtime.backend}`,
    `guard     ${report.runtime.guard}`,
    `domain    ${report.baseDomain}`,
    `routes    ${report.routesHash ?? 'not applied yet'}`,
    `audit     ${report.audit.failures === 0 ? 'ok' : `${report.audit.failures} failed writes (last: ${report.audit.last ?? 'unknown'})`}`,
  ];
  if (report.accounts.length > 0) {
    lines.push(
      '',
      table([
        ['ID', 'DESIRED', 'ACTUAL', 'HEALTHY'],
        ...report.accounts.map((a) => [a.id, a.desired, a.actual, a.healthy ? 'yes' : 'no']),
      ]),
    );
  }
  for (const m of report.domainMismatches) {
    lines.push(
      '',
      `WARNING: ${m.id} is stored as ${m.hostname}, which is not under ${report.baseDomain}; ` +
        'it keeps that hostname (nothing is rewritten)',
    );
  }
  for (const orphan of report.orphans) {
    lines.push('', `WARNING: unit ${orphan} belongs to this install but has no account record`);
  }
  return `${lines.join('\n')}\n`;
}
