import { runEvalCommand } from '../eval/eval-command.js';
import { PrintTerminal } from '../print-terminal.js';
import { isDoctorCommandName, runDoctorRoute } from './doctor-route.js';
import { readVersion } from './version.js';
import { runSessionAnalyze } from '../session-analyzer/session-analyze-command.js';
import { runSessionListCommand } from '../session-inventory/session-list-command.js';
import { launchSupervisedSession } from '../session-inventory/supervised-session-launch.js';
import { stopSupervisedSession } from '../session-inventory/supervised-session-control.js';
import { runSessionViewCommand } from '../session-inventory/session-view-command.js';
import { runUsageCommand } from '../usage/usage-command.js';
import { runUsageExportCommand } from '../usage/usage-export-command.js';
import {
  createInitialCliWorkspaceComposition,
  resolveInitialCliWorkspaceProjectAccess,
} from './workspace-project-composition.js';
import { runWorkspaceTrustCommand } from './workspace-trust-command.js';
import {
  formatHeadlessWorkspaceTrustError,
  requiresHeadlessWorkspaceTrust,
} from './workspace-trust-admission.js';

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
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'stop') {
    if (argv.length !== SUBCOMMAND_ARGUMENT_INDEX + 1) {
      process.stderr.write('Usage: robota session stop <supervised-id>\n');
      process.exitCode = 1;
      return true;
    }
    try {
      await stopSupervisedSession(argv[SUBCOMMAND_ARGUMENT_INDEX]!);
      process.stdout.write(`Stopped supervised session ${argv[SUBCOMMAND_ARGUMENT_INDEX]}.\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Unable to stop supervised session.'}\n`);
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'view') {
    process.exitCode = await runSessionViewCommand(argv.slice(SUBCOMMAND_ARGUMENT_INDEX));
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
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'list') {
    process.exitCode = await runSessionListCommand(
      argv.slice(SUBCOMMAND_ARGUMENT_INDEX),
      composition.projectAccess.status === 'trusted' ? composition.sessionStore : undefined,
    );
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'start') {
    if (argv.length !== SUBCOMMAND_ARGUMENT_INDEX + 1 || argv[SUBCOMMAND_ARGUMENT_INDEX] !== '--background') {
      process.stderr.write('Usage: robota session start --background\n');
      process.exitCode = 1;
      return true;
    }
    if (requiresHeadlessWorkspaceTrust(composition.projectAccess)) {
      process.stderr.write(`${formatHeadlessWorkspaceTrustError(composition.projectAccess, cwd)}\n`);
      process.exitCode = 1;
      return true;
    }
    try {
      const id = await launchSupervisedSession(cwd);
      process.stdout.write(`Supervised session: ${id}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Supervised session could not start.'}\n`);
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] !== 'eval') return false;
  process.exitCode = await runEvalCommand(argv.slice(ACTION_INDEX), cwd, {
    settingsSources: composition.settingsSources,
    projectAccess: composition.projectAccess,
  });
  return true;
}
