import { executeWorkflowsCatalog } from './catalog-command.js';
import { executeWorkflowsList } from './list-command.js';
import { executeWorkflowsRun } from './run-command.js';
import { executeWorkflowsValidate } from './validate-command.js';
import { executeWorkflowsCreate } from './create-command.js';
import { executeWorkflowsBuild } from './build-command.js';
import { renderWorkflowsUsage, WORKFLOWS_SUBCOMMANDS } from './subcommands.js';

import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  ICommandHostWorkspace,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type {
  ICommand,
  ICommandResult,
  ICommandSource,
} from '@robota-sdk/agent-interface-transport';

const WORKFLOWS_DESCRIPTION =
  'Author (from natural language), list, validate, and run DAG workflows on the in-process runtime';
const WORKFLOWS_ARGUMENT_HINT = `<${WORKFLOWS_SUBCOMMANDS.map((s) => s.name).join('|')}> [args]`;

/** The `ICommand` view of the shared subcommand registry (`subcommands.ts` is the SSOT). */
const SUBCOMMANDS: ICommand[] = WORKFLOWS_SUBCOMMANDS.map((sub) => ({
  name: sub.name,
  description: sub.description,
  source: 'workflows',
  ...(sub.argumentHint ? { argumentHint: sub.argumentHint } : {}),
  modelInvocable: sub.modelInvocable,
}));

const USAGE = renderWorkflowsUsage();

/** Parse the leading subcommand token + remaining argument string. */
function splitSubcommand(args: string): { sub: string; rest: string } {
  const trimmed = args.trim();
  if (trimmed === '') return { sub: '', rest: '' };
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { sub: trimmed, rest: '' };
  return { sub: trimmed.slice(0, spaceIdx), rest: trimmed.slice(spaceIdx + 1).trim() };
}

async function executeWorkflowsCommand(
  context: ICommandHostWorkspace,
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
      return executeWorkflowsList(cwd, workspace);
    case 'catalog':
      return executeWorkflowsCatalog(cwd, workspace);
    case 'validate':
      return executeWorkflowsValidate(rest, cwd, workspace);
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
