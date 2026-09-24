/** Plain-text rendering of a doctor report — the same lines for the shell route and `/doctor`. */
import type { IDoctorCheck, IDoctorReport, TDoctorCheckStatus } from './doctor-types.js';

const ICON: Record<TDoctorCheckStatus, string> = {
  ok: '✓',
  warn: '⚠',
  fail: '✗',
  'not-configured': '○',
  'not-probed': '–',
};

/** Optional product wording supplied by the host; omission keeps diagnostics product-neutral. */
export interface IDoctorDisplayVocabulary {
  readonly title?: string;
  readonly productName?: string;
  readonly formatRepairCommand?: (checkId: string) => string;
  readonly repairOffer?: string;
}

function renderCheck(check: IDoctorCheck, display: IDoctorDisplayVocabulary): string[] {
  const head = `  ${ICON[check.status]} ${check.label} [${check.id}] ${check.status}${check.cause === undefined ? '' : `: ${check.cause}`}`;
  const lines = [head];
  if (check.path !== undefined) lines.push(`      path: ${check.path}`);
  for (const line of check.detail ?? []) lines.push(`      ${line}`);
  if (check.repair !== undefined) {
    const repairAction = display.formatRepairCommand?.(check.repair);
    lines.push(
      `      repair: ${repairAction ?? `request repair for ${check.repair} through your host`}`,
    );
  }
  return lines;
}

function summary(report: IDoctorReport, display: IDoctorDisplayVocabulary): string {
  const productName = display.productName?.trim();
  if (report.failCount === 0 && report.warnCount === 0)
    return productName
      ? `✓ All checks passed. ${productName} is ready to use.`
      : '✓ All checks passed.';
  if (report.failCount > 0)
    return productName
      ? `✗ ${report.failCount} issue(s) found. Fix the items above to use ${productName}.`
      : `✗ ${report.failCount} issue(s) found. Fix the items above before use.`;
  return productName
    ? `⚠ ${report.warnCount} warning(s). ${productName} may work but check the items above.`
    : `⚠ ${report.warnCount} warning(s). Check the items above.`;
}

/** Render the report as lines: a title, every check, then the summary and the repair offers. */
export function renderDoctorReport(
  report: IDoctorReport,
  display: IDoctorDisplayVocabulary = {},
): string[] {
  const lines = [
    '',
    display.title ?? 'Doctor',
    '',
    ...report.checks.flatMap((check) => renderCheck(check, display)),
    '',
    summary(report, display),
  ];
  if (report.repairable.length > 0) {
    lines.push(
      `  repairable: ${report.repairable.join(', ')} — ${display.repairOffer ?? 'ask your host to apply a repair'}`,
    );
  }
  lines.push('');
  return lines;
}
