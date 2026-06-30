import { executeWorkflowsList } from './list-command.js';
import { executeWorkflowsRun } from './run-command.js';

import type {
  ICommandModule,
  ICommandHostContext,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type {
  ICommand,
  ICommandResult,
  ICommandSource,
} from '@robota-sdk/agent-interface-transport';

const WORKFLOWS_DESCRIPTION = 'Build and run DAG workflows on the in-process runtime';
const WORKFLOWS_ARGUMENT_HINT = '<list|run> [args]';

const SUBCOMMANDS: ICommand[] = [
  {
    name: 'list',
    description: 'List available workflow nodes',
    source: 'workflows',
    modelInvocable: false,
  },
  {
    name: 'run',
    description: 'Run a .dag.json workflow file',
    source: 'workflows',
    argumentHint: '<file.dag.json>',
    modelInvocable: false,
  },
];

const USAGE = [
  'Usage: /workflows <list|run>',
  '  list            List available workflow nodes',
  '  run <file>      Run a .dag.json workflow file',
].join('\n');

/** Parse the leading subcommand token + remaining argument string. */
function splitSubcommand(args: string): { sub: string; rest: string } {
  const trimmed = args.trim();
  if (trimmed === '') return { sub: '', rest: '' };
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { sub: trimmed, rest: '' };
  return { sub: trimmed.slice(0, spaceIdx), rest: trimmed.slice(spaceIdx + 1).trim() };
}

async function executeWorkflowsCommand(
  _context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const { sub, rest } = splitSubcommand(args);
  switch (sub) {
    case '':
      return { success: true, message: USAGE };
    case 'list':
      return executeWorkflowsList();
    case 'run':
      return executeWorkflowsRun(rest, process.cwd());
    default:
      return { success: false, message: `Unknown subcommand "${sub}".\n${USAGE}` };
  }
}

export function createWorkflowsCommandEntry(): ICommand {
  return {
    name: 'workflows',
    displayName: 'Workflows',
    description: WORKFLOWS_DESCRIPTION,
    source: 'workflows',
    argumentHint: WORKFLOWS_ARGUMENT_HINT,
    subcommands: SUBCOMMANDS,
    modelInvocable: false,
  };
}

function createWorkflowsSystemCommand(): ISystemCommand {
  const entry = createWorkflowsCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: executeWorkflowsCommand,
  };
}

export class WorkflowsCommandSource implements ICommandSource {
  readonly name = 'workflows';

  getCommands(): ICommand[] {
    return [createWorkflowsCommandEntry()];
  }
}

export function createWorkflowsCommandModule(): ICommandModule {
  return {
    name: 'agent-command-workflows',
    commandSources: [new WorkflowsCommandSource()],
    systemCommands: [createWorkflowsSystemCommand()],
  };
}
