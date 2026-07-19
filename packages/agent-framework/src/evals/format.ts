/**
 * SELFHOST-011 P3 — neutral `formatEvalReport`, the shared SDK renderer for an eval report.
 *
 * Consolidates the formatter the `robota eval` CLI carried privately (SELFHOST-011 P2) so any SDK consumer renders
 * a report identically without re-implementing it. Pure — no IO.
 */

import type { IEvalCaseResult, IEvalReport } from './eval-types.js';

/** Case-input display width in the report; longer inputs are elided with an ellipsis. */
const INPUT_DISPLAY_WIDTH = 60;
const ELLIPSIS = '...';

function formatScore(score: number | boolean): string {
  if (typeof score === 'boolean') {
    return score ? 'pass' : 'fail';
  }
  return score.toFixed(2);
}

function formatCase(result: IEvalCaseResult, index: number): string {
  const perMetric = result.scores.map((s) => `${s.metric}=${formatScore(s.score)}`).join(', ');
  const input =
    result.input.length > INPUT_DISPLAY_WIDTH
      ? `${result.input.slice(0, INPUT_DISPLAY_WIDTH - ELLIPSIS.length)}${ELLIPSIS}`
      : result.input;
  return `  case ${index + 1} [${result.caseScore.toFixed(2)}] ${input} — ${perMetric}`;
}

/** A compact human/CI-readable report: a per-case line each + an overall `PASS`/`FAIL` line against the threshold. */
export function formatEvalReport(report: IEvalReport): string {
  const lines = [report.name ? `Eval: ${report.name}` : 'Eval'];
  report.results.forEach((result, index) => lines.push(formatCase(result, index)));
  lines.push(
    `Overall ${report.overallScore.toFixed(2)} vs threshold ${report.threshold.toFixed(2)} → ${
      report.passed ? 'PASS' : 'FAIL'
    }`,
  );
  return `${lines.join('\n')}\n`;
}
