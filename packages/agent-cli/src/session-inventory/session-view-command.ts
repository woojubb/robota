import { realpathSync, statSync } from 'node:fs';

import { renderSupervisedSessionView } from '@robota-sdk/agent-ui-terminal';

import { resolveScreenReaderRenderFields } from '../startup/screen-reader-enablement.js';
import { readUserSettingsOrExit } from '../startup/user-settings.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from './supervised-session-control.js';

import type { TSettingsData } from '@robota-sdk/agent-framework';

const VIEW_STATES = ['needs-input', 'working', 'idle', 'unknown', 'unverified', 'dead'] as const;
type TViewState = typeof VIEW_STATES[number];
const HELP = 'Usage: robota session view [--cwd <directory>] [--state <state>] [--screen-reader|--no-screen-reader]\n'
  + `States: ${VIEW_STATES.join(', ')}\n`;

function isViewState(value: string | undefined): value is TViewState {
  return VIEW_STATES.some((state) => state === value);
}

export interface ISessionViewCommandOptions {
  readonly isTTY?: boolean;
  readonly settings?: TSettingsData;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly root?: string;
  readonly render?: typeof renderSupervisedSessionView;
  readonly stop?: typeof stopSupervisedSession;
}

/** Run the global supervised view without constructing a foreground interactive session. */
export async function runSessionViewCommand(
  argv: readonly string[],
  options: ISessionViewCommandOptions = {},
): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  let flag: boolean | undefined;
  let cwdArg: string | undefined;
  let stateFilter: TViewState | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--screen-reader' || arg === '--no-screen-reader') {
      if (flag !== undefined) { process.stderr.write(HELP); return 1; }
      flag = arg === '--screen-reader';
    } else if (arg === '--cwd' && cwdArg === undefined && argv[index + 1] && !argv[index + 1]!.startsWith('--')) {
      cwdArg = argv[++index];
    } else if (arg === '--state' && stateFilter === undefined && isViewState(argv[index + 1])) {
      stateFilter = argv[++index] as TViewState;
    } else {
      process.stderr.write(HELP);
      return 1;
    }
  }
  if (!(options.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) {
    process.stderr.write('Session view requires an interactive TTY; use robota session list for finite text or JSON output.\n');
    return 1;
  }
  const screenReader = resolveScreenReaderRenderFields(
    options.settings ?? readUserSettingsOrExit(),
    flag,
    options.env ?? process.env,
  );
  let cwd: string | undefined;
  if (cwdArg !== undefined) {
    try {
      cwd = realpathSync(cwdArg);
      if (!statSync(cwd).isDirectory()) throw new Error('Not a directory.');
    } catch {
      process.stderr.write('Unable to select a working directory for the session view.\n');
      return 1;
    }
  }
  try {
    const root = options.root ?? resolveSupervisedDirectory();
    await (options.render ?? renderSupervisedSessionView)({
      loadRows: (signal) => listSupervisedSessions(root, signal, { cwd }),
      onStop: (id) => (options.stop ?? stopSupervisedSession)(id, root),
      filteredByCwd: cwd !== undefined,
      stateFilter,
      screenReader: screenReader.screenReader,
      screenReaderChannel: screenReader.screenReaderChannel,
      screenReaderHint: screenReader.screenReaderHint,
    });
    return 0;
  } catch {
    process.stderr.write('Unable to render the supervised session view.\n');
    return 1;
  }
}
