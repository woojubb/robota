/**
 * `robota session analyze` command.
 *
 * Usage:
 *   robota session analyze                  — analyze the most recent session
 *   robota session analyze --last <n>       — aggregate the last N sessions
 *   robota session analyze --session <id>   — analyze a specific session by ID prefix
 */

import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { projectPaths, userPaths } from '@robota-sdk/agent-framework';

import { analyzeSession, parseSessionFile } from './parser.js';
import { formatAggregateReport, formatSingleSession } from './reporter.js';
import type { IAggregateReport, ISessionTimingReport } from './types.js';

interface ISessionAnalyzeArgs {
  last: number | undefined;
  sessionId: string | undefined;
}

function parseSessionAnalyzeArgs(argv: string[]): ISessionAnalyzeArgs {
  let last: number | undefined;
  let sessionId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--last' && argv[i + 1]) {
      const n = parseInt(argv[i + 1]!, 10);
      if (!isNaN(n) && n > 0) last = n;
      i++;
    } else if (argv[i] === '--session' && argv[i + 1]) {
      sessionId = argv[i + 1];
      i++;
    }
  }

  return { last, sessionId };
}

function listSessionFilesIn(sessionsDir: string): string[] {
  try {
    return readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(sessionsDir, f));
  } catch {
    // allow-fallback: sessions directory may not exist on first run — empty list is correct response
    return [];
  }
}

/**
 * OBS-001 fix: sessions are persisted to the PROJECT store (`cwd/.robota/sessions`) by both
 * print and TUI modes, while older history may live at the USER level. Read both, de-dupe by
 * file basename (project wins on collision), and sort by basename — session ids are
 * timestamp-prefixed, so lexical order is chronological.
 */
function listSessionFiles(cwd: string): string[] {
  const byName = new Map<string, string>();
  for (const path of listSessionFilesIn(userPaths().sessions)) {
    byName.set(basename(path), path);
  }
  for (const path of listSessionFilesIn(projectPaths(cwd).sessions)) {
    byName.set(basename(path), path);
  }
  return [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, path]) => path);
}

function buildAggregateReport(reports: ISessionTimingReport[]): IAggregateReport {
  const llmIntervals = reports.flatMap((r) =>
    r.intervals.filter(
      (iv) =>
        iv.kind === 'user_to_first_tool' ||
        iv.kind === 'user_to_assistant' ||
        iv.kind === 'llm_between_tools' ||
        iv.kind === 'llm_final_response',
    ),
  );
  const toolIntervals = reports.flatMap((r) => r.intervals.filter((iv) => iv.kind === 'tool_exec'));

  const avgLlmResponseMs = llmIntervals.length
    ? Math.round(llmIntervals.reduce((s, iv) => s + iv.durationMs, 0) / llmIntervals.length)
    : 0;
  const avgToolExecMs = toolIntervals.length
    ? Math.round(toolIntervals.reduce((s, iv) => s + iv.durationMs, 0) / toolIntervals.length)
    : 0;

  let maxSingleDelayMs = 0;
  let maxSingleDelaySession = '';
  let maxSingleDelayTurn = 0;
  let maxSingleDelayKind = '';

  for (const r of reports) {
    for (const iv of r.intervals) {
      if (iv.durationMs > maxSingleDelayMs) {
        maxSingleDelayMs = iv.durationMs;
        maxSingleDelaySession = r.sessionId;
        maxSingleDelayTurn = iv.turnIndex;
        maxSingleDelayKind = iv.kind;
      }
    }
  }

  const dates = reports.map((r) => r.createdAt).sort();

  return {
    sessionCount: reports.length,
    fromDate: dates[0] ?? '',
    toDate: dates[dates.length - 1] ?? '',
    avgLlmResponseMs,
    avgToolExecMs,
    maxSingleDelayMs,
    maxSingleDelaySession,
    maxSingleDelayTurn,
    maxSingleDelayKind,
  };
}

export async function runSessionAnalyze(
  argv: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  const args = parseSessionAnalyzeArgs(argv);
  const allFiles = listSessionFiles(cwd);

  if (allFiles.length === 0) {
    process.stderr.write(
      `No session files found in ${projectPaths(cwd).sessions} or ${userPaths().sessions}\n`,
    );
    process.exit(1);
  }

  if (args.sessionId !== undefined) {
    const matched = allFiles.find((f) => f.includes(args.sessionId!));
    if (!matched) {
      process.stderr.write(`Session not found: ${args.sessionId}\n`);
      process.exit(1);
    }
    const record = parseSessionFile(matched);
    const report = analyzeSession(record);
    process.stdout.write(formatSingleSession(report) + '\n');
    return;
  }

  if (args.last !== undefined) {
    const files = allFiles.slice(-args.last);
    const reports: ISessionTimingReport[] = [];
    for (const f of files) {
      try {
        reports.push(analyzeSession(parseSessionFile(f)));
      } catch {
        // allow-fallback: corrupted or partial session files are skipped — expected on interrupted writes
        // skip unreadable session files
      }
    }
    if (reports.length === 0) {
      process.stderr.write('No valid sessions found.\n');
      process.exit(1);
    }
    const aggregate = buildAggregateReport(reports);
    process.stdout.write(formatAggregateReport(aggregate) + '\n');
    return;
  }

  // Default: analyze the most recent session
  const latest = allFiles[allFiles.length - 1];
  if (!latest) {
    process.stderr.write('No sessions found.\n');
    process.exit(1);
  }
  const record = parseSessionFile(latest);
  const report = analyzeSession(record);
  process.stdout.write(formatSingleSession(report) + '\n');
}
