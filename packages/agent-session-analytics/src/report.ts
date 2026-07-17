/**
 * Text report formatters for session timing analysis. Pure — every function returns a string;
 * callers (e.g. a CLI command) own writing to stdout.
 */

import type { IAggregateReport, ISessionTimingReport, ITimingInterval } from './types.js';
import type { IUsageBySourceReport } from './usage.js';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/** SELFHOST-004: render a USD cost; `~` prefix marks an inexact aggregate (some unpriced turns). */
function fmtCost(usd: number, exact: boolean): string {
  return `${exact ? '' : '~'}$${usd.toFixed(4)}`;
}

/**
 * ANALYTICS-001 + SELFHOST-004: render a per-source token+cost breakdown and the per-operation span
 * timeline — which part of the session burned the most tokens/cost, and where the wall-clock went.
 * Pure; the caller owns writing it (the headless CLI path for the TUI/GUI trace/cost view).
 */
export function formatUsageReport(report: IUsageBySourceReport): string {
  const lines: string[] = [];
  lines.push(`Token usage — session ${report.sessionId}`);
  lines.push(
    `  total ${fmtTokens(report.totalTokens)} (prompt ${fmtTokens(report.promptTokens)} · completion ${fmtTokens(report.completionTokens)})`,
  );
  lines.push(`  cost ${fmtCost(report.costUsd, report.costExact)}`);
  if (report.bySource.length === 0) {
    lines.push('  (no usage recorded)');
  } else {
    lines.push('  by source (most tokens first):');
    for (const s of report.bySource) {
      lines.push(
        `    ${s.label.padEnd(24)} ${String(s.percentage).padStart(5)}%  ${fmtTokens(s.totalTokens).padStart(7)}  ${fmtCost(s.costUsd, s.costExact).padStart(10)}  (${s.turns} turn${s.turns === 1 ? '' : 's'})`,
      );
    }
    if (report.topConsumer) {
      lines.push(`  top consumer: ${report.topConsumer.label} (${report.topConsumer.percentage}%)`);
    }
  }

  // SELFHOST-004: the span timeline — sub-turn operations grouped under their owning turn.
  if (report.timeline.length > 0) {
    lines.push('  trace (per turn, sub-turn spans):');
    for (const turn of report.timeline) {
      lines.push(
        `    turn ${turn.turnIndex} — ${turn.label} · ${fmtMs(turn.totalDurationMs)} across ${turn.spans.length} op${turn.spans.length === 1 ? '' : 's'}`,
      );
      for (const span of turn.spans) {
        lines.push(`      ${span.op.padEnd(22)} ${fmtMs(span.durationMs).padStart(8)}`);
      }
    }
  }
  return lines.join('\n');
}

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
