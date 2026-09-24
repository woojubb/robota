import { renderSupervisedSessionView } from '@robota-sdk/agent-ui-terminal';

import { resolveScreenReaderRenderFields } from '../startup/screen-reader-enablement.js';
import { readUserSettingsOrExit } from '../startup/user-settings.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from './supervised-session-control.js';

import type { TSettingsData } from '@robota-sdk/agent-framework';

const HELP = 'Usage: robota session view [--screen-reader|--no-screen-reader]\n';

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
  const flag = argv.length === 0 ? undefined
    : argv.length === 1 && argv[0] === '--screen-reader' ? true
      : argv.length === 1 && argv[0] === '--no-screen-reader' ? false : null;
  if (flag === null) {
    process.stderr.write(HELP);
    return 1;
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
  try {
    const root = options.root ?? resolveSupervisedDirectory();
    await (options.render ?? renderSupervisedSessionView)({
      loadRows: (signal) => listSupervisedSessions(root, signal),
      onStop: (id) => (options.stop ?? stopSupervisedSession)(id, root),
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
