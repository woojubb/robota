/**
 * `robota session analyze` command — thin CLI wiring around `@robota-sdk/agent-session-analytics`.
 *
 * Usage:
 *   robota session analyze                  — analyze the most recent session
 *   robota session analyze --last <n>       — aggregate the last N sessions
 *   robota session analyze --session <id>   — analyze a specific session by ID prefix
 *
 * This file only resolves session stores, parses args, and writes output. All timing analysis and
 * report formatting lives in the analytics package; record loading lives in agent-session (via the
 * agent-framework session-store facades). agent-cli stays a thin shell.
 */

import {
  createProjectSessionStore,
  createUserSessionStore,
  projectPaths,
  userPaths,
} from '@robota-sdk/agent-framework';
import {
  aggregateReports,
  analyzeSession,
  formatAggregateReport,
  formatSingleSession,
} from '@robota-sdk/agent-session-analytics';

import type { ISessionAnalysisInput } from '@robota-sdk/agent-session-analytics';

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

/**
 * Load session records from the user store (`~/.robota/sessions`) and the project store
 * (`cwd/.robota/sessions` + replay logs), de-duped by id (project wins on collision) and sorted by
 * id ascending — session ids are timestamp-prefixed, so lexical order is chronological.
 */
function loadSessionRecords(cwd: string): ISessionAnalysisInput[] {
  const byId = new Map<string, ISessionAnalysisInput>();
  for (const record of createUserSessionStore().list()) {
    byId.set(record.id, record);
  }
  for (const record of createProjectSessionStore(cwd).list()) {
    byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function runSessionAnalyze(
  argv: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  const args = parseSessionAnalyzeArgs(argv);
  const records = loadSessionRecords(cwd);

  if (records.length === 0) {
    process.stderr.write(
      `No session files found in ${projectPaths(cwd).sessions} or ${userPaths().sessions}\n`,
    );
    process.exit(1);
  }

  if (args.sessionId !== undefined) {
    const matched = records.find((r) => r.id.includes(args.sessionId!));
    if (!matched) {
      process.stderr.write(`Session not found: ${args.sessionId}\n`);
      process.exit(1);
    }
    process.stdout.write(formatSingleSession(analyzeSession(matched)) + '\n');
    return;
  }

  if (args.last !== undefined) {
    const reports = records.slice(-args.last).map((r) => analyzeSession(r));
    if (reports.length === 0) {
      process.stderr.write('No valid sessions found.\n');
      process.exit(1);
    }
    process.stdout.write(formatAggregateReport(aggregateReports(reports)) + '\n');
    return;
  }

  // Default: analyze the most recent session
  const latest = records[records.length - 1];
  if (!latest) {
    process.stderr.write('No sessions found.\n');
    process.exit(1);
  }
  process.stdout.write(formatSingleSession(analyzeSession(latest)) + '\n');
}
