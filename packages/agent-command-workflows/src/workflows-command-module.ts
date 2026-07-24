import { executeWorkflowsCatalog } from './catalog-command.js';
import { executeWorkflowsList } from './list-command.js';
import { executeWorkflowsRun } from './run-command.js';
import { executeWorkflowsValidate } from './validate-command.js';
import { executeWorkflowsCreate } from './create-command.js';
import { executeWorkflowsBuild } from './build-command.js';

import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
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

const WORKFLOWS_DESCRIPTION =
  'Author (from natural language), list, validate, and run DAG workflows on the in-process runtime';
const WORKFLOWS_ARGUMENT_HINT = '<create|build|list|catalog|validate|run> [args]';

const SUBCOMMANDS: ICommand[] = [
  {
    name: 'create',
    description: 'Author a workflow from a natural-language description and run it immediately',
    source: 'workflows',
    argumentHint: '"<description>" [--input key=value] [--name <name>]',
    modelInvocable: true,
  },
  {
    name: 'build',
    description:
      'Author a workflow from a natural-language description and save it for review (no run)',
    source: 'workflows',
    argumentHint: '"<description>" [--input key=value] [--name <name>]',
    modelInvocable: true,
  },
  {
    name: 'list',
    description: 'List available workflow nodes',
    source: 'workflows',
    modelInvocable: false,
  },
  {
    name: 'catalog',
    description: 'List workflow files in the local .workflows catalog',
    source: 'workflows',
    modelInvocable: false,
  },
  {
    name: 'validate',
    description: 'Validate a workflow file against the node catalog',
    source: 'workflows',
    argumentHint: '<file.json>',
    modelInvocable: false,
  },
  {
    name: 'run',
    description: 'Run a workflow file',
    source: 'workflows',
    argumentHint: '<file.json>',
    modelInvocable: false,
  },
];

const USAGE = [
  'Usage: /workflows <create|build|list|catalog|validate|run>',
  '  create "<desc>"  Author a workflow from natural language and run it',
  '  build "<desc>"   Author a workflow from natural language and save it (no run)',
  '  list             List available workflow nodes',
  '  catalog          List workflow files in .workflows',
  '  validate <file>  Validate a workflow file',
  '  run <file>       Run a workflow file',
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
  context: ICommandHostContext,
  args: string,
  workspace: IWorkspaceLayout,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<ICommandResult> {
  const { sub, rest } = splitSubcommand(args);
  const cwd = context.getCwd();
  switch (sub) {
    case '':
      return { success: true, message: USAGE };
    case 'create':
      return executeWorkflowsCreate(rest, cwd, { workspace, providerDefinitions });
    case 'build':
      return executeWorkflowsBuild(rest, cwd, { workspace, providerDefinitions });
    case 'list':
      return executeWorkflowsList();
    case 'catalog':
      return executeWorkflowsCatalog(cwd, workspace);
    case 'validate':
      return executeWorkflowsValidate(rest, cwd);
    case 'run':
      return executeWorkflowsRun(rest, cwd, workspace);
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
    // FLOW-007 Phase 4: model-invocable so the agent can author + run a workflow from chat
    // (via the `create` subcommand); the other subcommands remain user-facing.
    modelInvocable: true,
  };
}

function createWorkflowsSystemCommand(
  workspace: IWorkspaceLayout,
  providerDefinitions: readonly IProviderDefinition[],
): ISystemCommand {
  const entry = createWorkflowsCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: (context, args) =>
      executeWorkflowsCommand(context, args, workspace, providerDefinitions),
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
  /** Provider definitions used to resolve the active provider for `/workflows create`. */
  readonly providerDefinitions?: readonly IProviderDefinition[];
}

export function createWorkflowsCommandModule(
  deps: IWorkflowsCommandModuleDeps = {},
): ICommandModule {
  const workspace = deps.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const providerDefinitions = deps.providerDefinitions ?? [];
  return {
    name: 'agent-command-workflows',
    commandSources: [new WorkflowsCommandSource()],
    systemCommands: [createWorkflowsSystemCommand(workspace, providerDefinitions)],
  };
}
