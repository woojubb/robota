/**
 * Text report formatter for session timing analysis.
 */

import type { IAggregateReport, ISessionTimingReport, ITimingInterval } from './types.js';

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZoneName: 'short' }).slice(0, 16);
}

function intervalLabel(iv: ITimingInterval): string {
  const map: Record<string, string> = {
    user_to_first_tool: 'user → tool-start',
    user_to_assistant: 'user → assistant',
    tool_exec: 'tool-start → tool-end',
    llm_between_tools: 'tool-end → tool-start',
    llm_final_response: 'tool-end → assistant/summary',
  };
  return map[iv.kind] ?? iv.kind;
}

function verdictLine(report: ISessionTimingReport): string {
  const { stats } = report;
  const totalMs = stats.llmWaitMs.total + stats.toolExecMs.avg * stats.toolExecMs.count;
  if (totalMs === 0) return 'Verdict: No timing data available.';
  const llmPct = Math.round((stats.llmWaitMs.total / totalMs) * 100);
  const toolPct = 100 - llmPct;
  return `Verdict: LLM API wait ${llmPct}% | Code processing ${toolPct}%`;
}

export function formatSingleSession(report: ISessionTimingReport): string {
  const lines: string[] = [];
  const { stats } = report;

  lines.push(`Session: ${report.sessionId}`);
  lines.push(`Created: ${fmtDate(report.createdAt)} | cwd: ${report.cwd}`);
  lines.push('');
  lines.push('Timing Summary:');

  if (stats.llmWaitMs.count > 0) {
    lines.push(
      `  LLM API wait        ${fmtMs(stats.llmWaitMs.avg).padStart(8)} avg  |  ${fmtMs(stats.llmWaitMs.max).padStart(8)} max`,
    );
  }
  if (stats.toolExecMs.count > 0) {
    lines.push(
      `  Tool execution      ${fmtMs(stats.toolExecMs.avg).padStart(8)} avg  |  ${fmtMs(stats.toolExecMs.median).padStart(8)} median`,
    );
  }
  if (stats.userToAssistantMs.count > 0) {
    lines.push(`  user → assistant    ${fmtMs(stats.userToAssistantMs.avg).padStart(8)} avg`);
  }
  if (stats.llmWaitMs.count === 0 && stats.toolExecMs.count === 0) {
    lines.push('  (no intervals computed — session may have no history)');
  }

  if (report.slowIntervals.length > 0) {
    lines.push('');
    lines.push('Slow intervals (>10s):');
    for (const iv of report.slowIntervals) {
      lines.push(
        `  turn ${iv.turnIndex}  ${intervalLabel(iv).padEnd(32)} ${fmtMs(iv.durationMs).padStart(8)}`,
      );
    }
  }

  lines.push('');
  lines.push(verdictLine(report));

  return lines.join('\n');
}

export function formatAggregateReport(aggregate: IAggregateReport): string {
  const lines: string[] = [];
  lines.push(
    `Analyzed ${aggregate.sessionCount} sessions (${fmtDate(aggregate.fromDate)} ~ ${fmtDate(aggregate.toDate)})`,
  );
  lines.push(`  Avg LLM response:   ${fmtMs(aggregate.avgLlmResponseMs)}`);
  lines.push(`  Avg tool exec:      ${fmtMs(aggregate.avgToolExecMs)}`);
  if (aggregate.maxSingleDelayMs > 0) {
    lines.push(
      `  Max single delay:   ${fmtMs(aggregate.maxSingleDelayMs)} (${aggregate.maxSingleDelaySession}, turn ${aggregate.maxSingleDelayTurn}, ${aggregate.maxSingleDelayKind})`,
    );
  }
  return lines.join('\n');
}
