import { runEvalCommand } from '../eval/eval-command.js';
import { PrintTerminal } from '../print-terminal.js';
import { isDoctorCommandName, runDoctorRoute } from './doctor-route.js';
import { readVersion } from './version.js';
import { runSessionAnalyze } from '../session-analyzer/session-analyze-command.js';
import { runUsageCommand } from '../usage/usage-command.js';
import { runUsageExportCommand } from '../usage/usage-export-command.js';
import {
  createInitialCliWorkspaceComposition,
  resolveInitialCliWorkspaceProjectAccess,
} from './workspace-project-composition.js';
import { runWorkspaceTrustCommand } from './workspace-trust-command.js';

import type { IStartCliOptions } from './command-setup.js';

const SUBCOMMAND_INDEX = 2;
const ACTION_INDEX = 3;
const SUBCOMMAND_ARGUMENT_INDEX = 4;

/** Route subcommands whose own flags must bypass the strict global CLI parser. */
export async function runPreparsedCliCommand(
  options: IStartCliOptions,
  argv: readonly string[] = process.argv,
  cwd: string = process.cwd(),
): Promise<boolean> {
  // OBSERVABILITY-1991: the doctor is matched BEFORE the shared composition below, and composes its
  // own inside a failure boundary — a configuration broken enough to throw here must still be
  // diagnosable, and `--repair <id>` / `--yes` must never reach the strict global parser.
  if (isDoctorCommandName(argv[SUBCOMMAND_INDEX])) {
    process.exitCode = await runDoctorRoute(
      {
        version: readVersion(),
        terminal: new PrintTerminal(),
        cwd,
        options,
        isTTY: process.stdin.isTTY === true,
      },
      argv.slice(ACTION_INDEX),
      argv[SUBCOMMAND_INDEX],
    );
    return true;
  }
  const projectAccess = await resolveInitialCliWorkspaceProjectAccess(cwd, options);
  const composition = createInitialCliWorkspaceComposition(cwd, {
    ...options,
    projectAccess,
  });
  if (argv[SUBCOMMAND_INDEX] === 'trust') {
    process.exitCode = await runWorkspaceTrustCommand(argv.slice(ACTION_INDEX), cwd);
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'usage') {
    const usageArgs = argv.slice(ACTION_INDEX);
    const projectSessionStore =
      composition.projectAccess.status === 'trusted' ? composition.sessionStore : undefined;
    process.exitCode =
      usageArgs[0] === 'export'
        ? await runUsageExportCommand(usageArgs.slice(1), projectSessionStore)
        : runUsageCommand(usageArgs, projectSessionStore);
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'analyze') {
    await runSessionAnalyze(
      argv.slice(SUBCOMMAND_ARGUMENT_INDEX),
      cwd,
      composition.projectAccess.status === 'trusted' ? composition.sessionStore : undefined,
    );
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] !== 'eval') return false;
  process.exitCode = await runEvalCommand(argv.slice(ACTION_INDEX), cwd, {
    settingsSources: composition.settingsSources,
    projectAccess: composition.projectAccess,
  });
  return true;
}
