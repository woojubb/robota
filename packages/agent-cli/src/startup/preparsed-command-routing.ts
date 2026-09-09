import { runEvalCommand } from '../eval/eval-command.js';
import { runSessionAnalyze } from '../session-analyzer/session-analyze-command.js';
import { runUsageCommand } from '../usage/usage-command.js';
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
    process.exitCode = runUsageCommand(
      argv.slice(ACTION_INDEX),
      composition.projectAccess.status === 'trusted' ? composition.sessionStore : undefined,
    );
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
