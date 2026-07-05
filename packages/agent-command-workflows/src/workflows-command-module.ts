import { executeWorkflowsCatalog } from './catalog-command.js';
import { executeWorkflowsList } from './list-command.js';
import { executeWorkflowsRun } from './run-command.js';
import { executeWorkflowsValidate } from './validate-command.js';

import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
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

const WORKFLOWS_DESCRIPTION = 'List, validate, and run DAG workflows on the in-process runtime';
const WORKFLOWS_ARGUMENT_HINT = '<list|catalog|validate|run> [args]';

const SUBCOMMANDS: ICommand[] = [
  {
    name: 'list',
    description: 'List available workflow nodes',
    source: 'workflows',
    modelInvocable: false,
  },
  {
    name: 'catalog',
    description: 'List workflow files in the local .dag/workflows catalog',
    source: 'workflows',
    modelInvocable: false,
  },
  {
    name: 'validate',
    description: 'Validate a .dag.json workflow file against the node catalog',
    source: 'workflows',
    argumentHint: '<file.dag.json>',
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
  'Usage: /workflows <list|catalog|validate|run>',
  '  list             List available workflow nodes',
  '  catalog          List workflow files in .dag/workflows',
  '  validate <file>  Validate a .dag.json workflow file',
  '  run <file>       Run a .dag.json workflow file',
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
  workspace: IWorkspaceLayout,
): Promise<ICommandResult> {
  const { sub, rest } = splitSubcommand(args);
  switch (sub) {
    case '':
      return { success: true, message: USAGE };
    case 'list':
      return executeWorkflowsList();
    case 'catalog':
      return executeWorkflowsCatalog(process.cwd(), workspace);
    case 'validate':
      return executeWorkflowsValidate(rest, process.cwd());
    case 'run':
      return executeWorkflowsRun(rest, process.cwd(), workspace);
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

function createWorkflowsSystemCommand(workspace: IWorkspaceLayout): ISystemCommand {
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
    execute: (context, args) => executeWorkflowsCommand(context, args, workspace),
  };
}

export class WorkflowsCommandSource implements ICommandSource {
  readonly name = 'workflows';

  getCommands(): ICommand[] {
    return [createWorkflowsCommandEntry()];
  }
}

/** Dependencies injected by the composition root (agent-cli's `command-setup`). FLOW-007 C1. */
export interface IWorkflowsCommandModuleDeps {
  /** Workspace layout for on-disk workflow/node paths. Defaults to `.workflows/`. */
  readonly workspace?: IWorkspaceLayout;
}

export function createWorkflowsCommandModule(
  deps: IWorkflowsCommandModuleDeps = {},
): ICommandModule {
  const workspace = deps.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  return {
    name: 'agent-command-workflows',
    commandSources: [new WorkflowsCommandSource()],
    systemCommands: [createWorkflowsSystemCommand(workspace)],
  };
}
