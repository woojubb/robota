/**
 * `the product session analyze` command — thin CLI wiring around `@robota-sdk/agent-session-analytics`.
 *
 * Usage:
 *   the product session analyze                  — analyze the most recent session
 *   the product session analyze --last <n>       — aggregate the last N sessions
 *   the product session analyze --session <id>   — analyze a specific session by ID prefix
 *   the product session analyze --usage          — token usage broken down by source (which agent /
 *                                             background task burned the most tokens)
 *
 * This file only resolves session stores, parses args, and writes output. All timing analysis and
 * report formatting lives in the analytics package; record loading lives in agent-session (via the
 * agent-framework session-store facades). agent-cli stays a thin shell.
 */

import {
  isSafeSessionId,
  lockedSessionMessage,
  lockedSessionReason,
  lockedSessionsNotice,
  scanSessionStore,
} from '@robota-sdk/agent-framework';
import {
  aggregateReports,
  analyzeSession,
  formatAggregateReport,
  formatSingleSession,
  formatUsageReport,
  summarizeUsageBySource,
} from '@robota-sdk/agent-session-analytics';

import type { TSessionAnalysisInput } from '@robota-sdk/agent-session-analytics';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

interface ISessionAnalyzeArgs {
  last: number | undefined;
  sessionId: string | undefined;
  usage: boolean;
}

function parseSessionAnalyzeArgs(argv: string[]): ISessionAnalyzeArgs {
  let last: number | undefined;
  let sessionId: string | undefined;
  let usage = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--last' && argv[i + 1]) {
      const n = parseInt(argv[i + 1]!, 10);
      if (!isNaN(n) && n > 0) last = n;
      i++;
    } else if (argv[i] === '--session' && argv[i + 1]) {
      sessionId = argv[i + 1];
      i++;
    } else if (argv[i] === '--usage') {
      usage = true;
    }
  }

  return { last, sessionId, usage };
}

/**
 * Load session records from the user store (`the configured user root/sessions`) and the project store
 * (`cwd/the configured project directory/sessions` + replay logs), de-duped by id (project wins on collision) and sorted by
 * id ascending — session ids are timestamp-prefixed, so lexical order is chronological. With them,
 * how many sealed sessions the stores left out because their keys are locked, from the same scan.
 */
function loadSessionRecords(
  userSessionStore: IInteractiveSessionStore,
  projectSessionStore: IInteractiveSessionStore | undefined,
): {
  readonly records: TSessionAnalysisInput[];
  readonly locked: number;
  readonly noKeys: number;
} {
  // Analysis needs readable records, so unreadable entries are skipped HERE rather than
  // by the store — the store now reports them, and each consumer decides what it can do with one.
  // An analyzer has nothing to analyse in a record it cannot decode.
  const byId = new Map<string, TSessionAnalysisInput>();
  const user = scanSessionStore(userSessionStore);
  const project = scanSessionStore(projectSessionStore);
  for (const entry of [...user.entries, ...project.entries]) {
    if (entry.outcome.status === 'valid') byId.set(entry.id, entry.outcome.record);
  }
  return {
    records: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    locked: user.locked + project.locked,
    noKeys: (user.noKeys ?? 0) + (project.noKeys ?? 0),
  };
}

function loadExactSessionRecord(
  sessionId: string,
  userSessionStore: IInteractiveSessionStore,
  projectSessionStore: IInteractiveSessionStore | undefined,
): TSessionAnalysisInput | undefined {
  if (!isSafeSessionId(sessionId)) return undefined;
  const userOutcome = userSessionStore.load(sessionId);
  const projectOutcome = projectSessionStore?.load(sessionId);
  if (projectOutcome?.status === 'valid') return projectOutcome.record;
  return userOutcome.status === 'valid' ? userOutcome.record : undefined;
}

export async function runSessionAnalyze(
  argv: string[],
  _cwd: string = process.cwd(),
  projectSessionStore?: IInteractiveSessionStore,
  userSessionStore: IInteractiveSessionStore = (() => { throw new Error('Session analysis requires an explicit user store.'); })(),
): Promise<void> {
  const args = parseSessionAnalyzeArgs(argv);
  let enumerated: ReturnType<typeof loadSessionRecords> | undefined;
  const enumerate = (): ReturnType<typeof loadSessionRecords> =>
    (enumerated ??= loadSessionRecords(userSessionStore, projectSessionStore));
  const requireConfiguredRecords = (): TSessionAnalysisInput[] => {
    const { records, locked, noKeys } = enumerate();
    if (records.length === 0) {
      const notice = lockedSessionsNotice(locked, noKeys);
      process.stderr.write(
        'No session files found in configured user or authorized project session stores.' +
          (notice !== undefined ? ` ${notice}` : '') +
          '\n',
      );
      process.exit(1);
    }
    return records;
  };
  // An analysis chosen from the listing — the latest, the last N, a substring — says how many sealed
  // sessions it could not consider, since one of them may be the session that was meant.
  const noteSkipped = (): void => {
    const notice =
      enumerated === undefined
        ? undefined
        : lockedSessionsNotice(enumerated.locked, enumerated.noKeys);
    if (notice !== undefined) process.stderr.write(`Skipped: ${notice}\n`);
  };
  const exact =
    args.sessionId === undefined
      ? undefined
      : loadExactSessionRecord(args.sessionId, userSessionStore, projectSessionStore);

  // A session that is there but sealed out of reach is not "not found", and must not fall through to
  // the prefix search, which only sees readable records.
  const lockedReason =
    args.sessionId === undefined || exact !== undefined
      ? undefined
      : [userSessionStore, projectSessionStore]
          .map((store) => lockedSessionReason(store, args.sessionId!))
          .find((reason) => reason !== undefined);
  if (args.sessionId !== undefined && lockedReason !== undefined) {
    process.stderr.write(`${lockedSessionMessage(args.sessionId, lockedReason)}\n`);
    process.exit(1);
  }

  if (args.usage) {
    const target =
      args.sessionId !== undefined
        ? (exact ??
          requireConfiguredRecords().find((record) => record.id.includes(args.sessionId!)))
        : requireConfiguredRecords().at(-1);
    noteSkipped();
    if (!target) {
      process.stderr.write(`Session not found${args.sessionId ? `: ${args.sessionId}` : ''}\n`);
      process.exit(1);
    }
    process.stdout.write(formatUsageReport(summarizeUsageBySource(target)) + '\n');
    return;
  }

  if (args.sessionId !== undefined) {
    const matched =
      exact ?? requireConfiguredRecords().find((record) => record.id.includes(args.sessionId!));
    noteSkipped();
    if (!matched) {
      process.stderr.write(`Session not found: ${args.sessionId}\n`);
      process.exit(1);
    }
    process.stdout.write(formatSingleSession(analyzeSession(matched)) + '\n');
    return;
  }

  const allRecords = requireConfiguredRecords();
  noteSkipped();

  if (args.last !== undefined) {
    const reports = allRecords.slice(-args.last).map((record) => analyzeSession(record));
    if (reports.length === 0) {
      process.stderr.write('No valid sessions found.\n');
      process.exit(1);
    }
    process.stdout.write(formatAggregateReport(aggregateReports(reports)) + '\n');
    return;
  }

  // Default: analyze the most recent session
  const latest = allRecords.at(-1);
  if (!latest) {
    process.stderr.write('No sessions found.\n');
    process.exit(1);
  }
  process.stdout.write(formatSingleSession(analyzeSession(latest)) + '\n');
}
