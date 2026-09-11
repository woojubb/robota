/** Deterministic presentation adapters for the private diagnostic result contract. */

import { assertDiagnosticReport } from './diagnostic-core.mjs';

function formatSubject(subject) {
  return `${subject.kind}:${subject.value}`;
}

function formatResult(result) {
  const lines = [
    `${result.state === 'clean' ? 'CLEAN' : result.severity.toUpperCase()} ${result.id} ` +
      `[${result.state}] ${formatSubject(result.subject)}`,
  ];
  if (result.state === 'clean') {
    lines.push(`  summary: ${result.summary}`);
    return lines;
  }
  for (const evidence of result.evidence) lines.push(`  evidence: ${evidence}`);
  lines.push(`  recommendation: ${result.recommendation}`);
  if (result.state === 'unavailable') {
    lines.push(`  unavailable: ${result.unavailable.code} — ${result.unavailable.detail}`);
  }
  if (result.state === 'diagnostic-publication-unavailable') {
    lines.push(`  publication: ${result.publication.target} — ${result.publication.detail}`);
  }
  return lines;
}

/** Render the canonical report shape as stable, human-inspectable JSON. */
export function renderDiagnosticReportJson(report) {
  return `${JSON.stringify(assertDiagnosticReport(report), null, 2)}\n`;
}

/** Render every non-clean result explicitly; a concise view must never imply a clean report. */
export function renderDiagnosticReportText(report) {
  const valid = assertDiagnosticReport(report);
  const lines = [
    `Diagnostic report v${valid.version}: ${valid.results.length} result(s), ` +
      `${valid.totals.nonClean} non-clean.`,
  ];
  for (const result of valid.results) lines.push(...formatResult(result));
  return `${lines.join('\n')}\n`;
}
