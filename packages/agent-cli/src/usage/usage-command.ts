import { createUserSessionStore } from '@robota-sdk/agent-framework';
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

interface IUsageCommandDependencies {
  readonly userSessionStore: IInteractiveSessionStore;
  readonly projectSessionStore?: IInteractiveSessionStore;
  readonly now?: Date;
}

interface IUsageCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const USAGE_HELP = `Usage: robota usage [options]

Options:
  --period <7d|30d>       Calendar period including the current partial day (default: 7d)
  --timezone <IANA>       Calendar timezone (default: system timezone)
  --format <text|json>    Output format (default: text)
  -h, --help              Show this help message
`;

interface IUsageCommandArgs extends IPersonalUsageRequest {
  readonly format: 'text' | 'json';
}

interface IEnumeratedUsageSnapshot {
  readonly records: readonly IInteractiveSessionRecord[];
  readonly corruptSessionIds: readonly string[];
  readonly unsupportedSessionIds: readonly string[];
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

function enumerateUsageSnapshot(dependencies: IUsageCommandDependencies): IEnumeratedUsageSnapshot {
  const records = new Map<string, IInteractiveSessionRecord>();
  const corrupt = new Set<string>();
  const unsupported = new Set<string>();
  for (const entry of dependencies.userSessionStore.list()) {
    collectOutcome(entry.id, entry.outcome, records, corrupt, unsupported);
  }
  // Project records are authoritative for duplicate ids because they are scoped to the active,
  // already-authorized workspace composition.
  for (const entry of dependencies.projectSessionStore?.list() ?? []) {
    collectOutcome(entry.id, entry.outcome, records, corrupt, unsupported);
  }
  return {
    records: [...records.values()],
    corruptSessionIds: [...corrupt],
    unsupportedSessionIds: [...unsupported],
  };
}

export function createPersonalUsageReporter(
  projectSessionStore?: IInteractiveSessionStore,
): (request: IPersonalUsageRequest) => IPersonalUsageReport {
  const userSessionStore = createUserSessionStore();
  return (request) =>
    createPersonalUsageReport(request, {
      userSessionStore,
      ...(projectSessionStore ? { projectSessionStore } : {}),
    });
}

export function createStoredSessionUsageReporter(
  projectSessionStore?: IInteractiveSessionStore,
): (sessionId: string) => ReturnType<typeof summarizeUsageBySource> {
  const userSessionStore = createUserSessionStore();
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
          : `Session ${sessionId} cannot be analyzed (${outcome.status}).`,
      );
    }
    return summarizeUsageBySource(outcome.record);
  };
}

export function executeUsageCommand(
  argv: readonly string[],
  dependencies: IUsageCommandDependencies,
): IUsageCommandResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { exitCode: 0, stdout: USAGE_HELP, stderr: '' };
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
  return {
    exitCode: 0,
    stdout:
      args.format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatPersonalUsageReport(report)}\n`,
    stderr: '',
  };
}

export function runUsageCommand(
  argv: readonly string[],
  projectSessionStore?: IInteractiveSessionStore,
): number {
  const result = executeUsageCommand(argv, {
    userSessionStore: createUserSessionStore(),
    ...(projectSessionStore ? { projectSessionStore } : {}),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
