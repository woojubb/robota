/** Plain-text rendering of a doctor report — the same lines for the shell route and `/doctor`. */
import type { IDoctorCheck, IDoctorReport, TDoctorCheckStatus } from './doctor-types.js';

const ICON: Record<TDoctorCheckStatus, string> = {
  ok: '✓',
  warn: '⚠',
  fail: '✗',
  'not-configured': '○',
  'not-probed': '–',
};

function renderCheck(check: IDoctorCheck): string[] {
  const head = `  ${ICON[check.status]} ${check.label} [${check.id}] ${check.status}${check.cause === undefined ? '' : `: ${check.cause}`}`;
  const lines = [head];
  if (check.path !== undefined) lines.push(`      path: ${check.path}`);
  for (const line of check.detail ?? []) lines.push(`      ${line}`);
  if (check.repair !== undefined)
    lines.push(`      repair: robota doctor --repair ${check.repair}`);
  return lines;
}

function summary(report: IDoctorReport): string {
  if (report.failCount === 0 && report.warnCount === 0)
    return '✓ All checks passed. robota is ready to use.';
  if (report.failCount > 0)
    return `✗ ${report.failCount} issue(s) found. Fix the items above to use robota.`;
  return `⚠ ${report.warnCount} warning(s). robota may work but check the items above.`;
}

/** Render the report as lines: a title, every check, then the summary and the repair offers. */
export function renderDoctorReport(report: IDoctorReport, title = 'robota doctor'): string[] {
  const lines = ['', title, '', ...report.checks.flatMap(renderCheck), '', summary(report)];
  if (report.repairable.length > 0) {
    lines.push(
      `  repairable: ${report.repairable.join(', ')} — run with --repair <check-id> (asks before writing; --yes skips the prompt)`,
    );
  }
  lines.push('');
  return lines;
}
