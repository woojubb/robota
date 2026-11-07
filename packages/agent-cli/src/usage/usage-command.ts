import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { lockedSessionMessage, scanSessionStore } from '@robota-sdk/agent-framework';
import {
  formatPersonalUsageReport,
  summarizePersonalUsage,
  summarizeUsageBySource,
} from '@robota-sdk/agent-session-analytics';

import type {
  IPersonalUsageReport,
  IPersonalUsageRequest,
} from '@robota-sdk/agent-session-analytics';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';
import { createProductUserSessionStore } from '../product/session-stores.js';

export interface IUsageCommandDependencies {
  readonly userSessionStore: IInteractiveSessionStore;
  readonly projectSessionStore?: IInteractiveSessionStore;
  readonly now?: Date;
}

interface IUsageCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE_HELP = `Usage: {{cli}} usage [options]

To export a content-free metric snapshot to a local OTLP collector:
  {{cli}} usage export --endpoint http://127.0.0.1:4318
To export recorded prompt root traces to a local OTLP collector:
  {{cli}} usage export --signal traces --endpoint http://127.0.0.1:4318
To export content-free recorded completion events to a local OTLP collector:
  {{cli}} usage export --signal logs --endpoint http://127.0.0.1:4318

Options:
  --period <7d|30d>       Calendar period including the current partial day (default: 7d)
  --timezone <IANA>       Calendar timezone (default: system timezone)
  --format <text|json>    Output format (default: text)
  -h, --help              Show this help message
`;

interface IUsageCommandArgs extends IPersonalUsageRequest {
  readonly format: 'text' | 'json';
}

export interface IEnumeratedUsageSnapshot {
  readonly records: readonly IInteractiveSessionRecord[];
  readonly corruptSessionIds: readonly string[];
  readonly unsupportedSessionIds: readonly string[];
  /**
   * Saved sessions that are sealed and cannot be opened right now. A listing leaves them out, so a
   * total built from listings silently excludes them unless this is carried and said.
   */
  readonly lockedSessionCount: number;
  /** Those of them sealed with keys this process does not have, which no unlock here opens. */
  readonly noKeysSessionCount: number;
}

function invalid(message: string): IUsageCommandResult {
  return { exitCode: 1, stdout: '', stderr: `${message}\n` };
}

function parseUsageArgs(argv: readonly string[]): IUsageCommandArgs | IUsageCommandResult {
  let period: IPersonalUsageRequest['period'] = '7d';
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let format: IUsageCommandArgs['format'] = 'text';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--period') {
      if (value !== '7d' && value !== '30d') {
        return invalid(`Invalid --period value: ${value ?? '(missing)'} (expected 7d or 30d)`);
      }
      period = value;
      index += 1;
      continue;
    }
    if (argument === '--timezone') {
      if (!value) return invalid('Missing value for --timezone');
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format();
      } catch {
        return invalid(`Invalid --timezone value: ${value}`);
      }
      timezone = value;
      index += 1;
      continue;
    }
    if (argument === '--format') {
      if (value !== 'text' && value !== 'json') {
        return invalid(`Invalid --format value: ${value ?? '(missing)'} (expected text or json)`);
      }
      format = value;
      index += 1;
      continue;
    }
    return invalid(`Unknown usage argument: ${argument ?? '(missing)'}`);
  }

  return { period, timezone, format };
}

function collectOutcome(
  id: string,
  outcome: TSessionLoadOutcome,
  records: Map<string, IInteractiveSessionRecord>,
  corrupt: Set<string>,
  unsupported: Set<string>,
): void {
  if (outcome.status === 'valid') {
    records.set(id, outcome.record);
    corrupt.delete(id);
    unsupported.delete(id);
  } else if (outcome.status === 'corrupt') {
    records.delete(id);
    corrupt.add(id);
    unsupported.delete(id);
  } else if (outcome.status === 'unsupported') {
    records.delete(id);
    unsupported.add(id);
    corrupt.delete(id);
  }
}

function createPersonalUsageReport(
  request: IPersonalUsageRequest,
  dependencies: IUsageCommandDependencies,
): IPersonalUsageReport {
  const snapshot = enumerateUsageSnapshot(dependencies);
  return summarizePersonalUsage({
    request,
    now: dependencies.now ?? new Date(),
    ...snapshot,
  });
}

export function enumerateUsageSnapshot(
  dependencies: IUsageCommandDependencies,
): IEnumeratedUsageSnapshot {
  const records = new Map<string, IInteractiveSessionRecord>();
  const corrupt = new Set<string>();
  const unsupported = new Set<string>();
  const user = scanSessionStore(dependencies.userSessionStore);
  for (const entry of user.entries) {
    collectOutcome(entry.id, entry.outcome, records, corrupt, unsupported);
  }
  // Project records are authoritative for duplicate ids because they are scoped to the active,
  // already-authorized workspace composition.
  const project = scanSessionStore(dependencies.projectSessionStore);
  for (const entry of project.entries) {
    collectOutcome(entry.id, entry.outcome, records, corrupt, unsupported);
  }
  const noKeys = (user.noKeys ?? 0) + (project.noKeys ?? 0);
  return {
    records: [...records.values()],
    corruptSessionIds: [...corrupt],
    unsupportedSessionIds: [...unsupported],
    lockedSessionCount: user.locked + project.locked + noKeys,
    noKeysSessionCount: noKeys,
  };
}

export function createPersonalUsageReporter(
  runtime: ICliRuntimeContext,
  projectSessionStore?: IInteractiveSessionStore,
): (request: IPersonalUsageRequest) => IPersonalUsageReport {
  const userSessionStore = createProductUserSessionStore(runtime);
  return (request) =>
    createPersonalUsageReport(request, {
      userSessionStore,
      ...(projectSessionStore ? { projectSessionStore } : {}),
    });
}

export function createStoredSessionUsageReporter(
  runtime: ICliRuntimeContext,
  projectSessionStore?: IInteractiveSessionStore,
): (sessionId: string) => ReturnType<typeof summarizeUsageBySource> {
  const userSessionStore = createProductUserSessionStore(runtime);
  return (sessionId) => {
    const projectOutcome = projectSessionStore?.load(sessionId);
    const outcome =
      projectOutcome && projectOutcome.status !== 'missing'
        ? projectOutcome
        : userSessionStore.load(sessionId);
    if (outcome.status !== 'valid') {
      throw new Error(
        outcome.status === 'missing'
          ? `Session ${sessionId} was not found.`
          : outcome.status === 'locked'
            ? lockedSessionMessage(sessionId, outcome.reason ?? 'locked')
            : `Session ${sessionId} cannot be analyzed (${outcome.status}).`,
      );
    }
    return summarizeUsageBySource(outcome.record);
  };
}

export function executeUsageCommand(
  argv: readonly string[],
  dependencies: IUsageCommandDependencies,
  cliName: string,
): IUsageCommandResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { exitCode: 0, stdout: USAGE_HELP.replaceAll('{{cli}}', cliName), stderr: '' };
  }
  const args = parseUsageArgs(argv);
  if ('exitCode' in args) return args;

  let snapshot: IEnumeratedUsageSnapshot;
  try {
    snapshot = enumerateUsageSnapshot(dependencies);
  } catch (error) {
    return invalid(
      `Unable to enumerate session stores: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    snapshot.records.length === 0 &&
    snapshot.corruptSessionIds.length + snapshot.unsupportedSessionIds.length > 0
  ) {
    return invalid('No readable session files found in configured session stores.');
  }
  const report = summarizePersonalUsage({
    request: { period: args.period, timezone: args.timezone },
    now: dependencies.now ?? new Date(),
    ...snapshot,
  });
  // The totals cover readable sessions only; sealed ones this process cannot open are not in them,
  // and the report must not read as the whole picture when part of it is out of reach — the count is
  // in the report itself, and said on stderr for a person reading the text, with an unlock only for
  // the ones an unlock would open.
  const noKeys = snapshot.noKeysSessionCount;
  const locked = snapshot.lockedSessionCount - noKeys;
  return {
    exitCode: 0,
    stdout:
      args.format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatPersonalUsageReport(report)}\n`,
    stderr:
      (locked > 0
        ? `Usage excludes ${locked} saved ${locked === 1 ? 'session that is' : 'sessions that are'} sealed and locked; unlock to include ${locked === 1 ? 'it' : 'them'}.\n`
        : '') +
      (noKeys > 0
        ? `Usage excludes ${noKeys} saved ${noKeys === 1 ? 'session' : 'sessions'} sealed with keys this process does not have.\n`
        : ''),
  };
}

export function runUsageCommand(
  argv: readonly string[],
  runtime: ICliRuntimeContext,
  projectSessionStore?: IInteractiveSessionStore,
): number {
  const result = executeUsageCommand(argv, {
    userSessionStore: createProductUserSessionStore(runtime),
    ...(projectSessionStore ? { projectSessionStore } : {}),
  }, runtime.config.identity.cliName);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
