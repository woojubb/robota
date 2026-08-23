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
  TSettingsSource,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';
import { assertWorkflowProject } from './workflow-project.js';

import type { IWorkflowProject } from './workflow-project.js';

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

/**
 * Refuse a subcommand the registry marks non-model-invocable when the MODEL is the caller.
 *
 * Returns `undefined` when there is nothing to refuse, so the dispatcher reads as "gate, then
 * dispatch" rather than as a branch a reader has to hold in their head.
 *
 * An unknown subcommand is NOT refused here — it falls through to the dispatcher's own "Unknown
 * subcommand" answer, which is a better message and keeps one place deciding what exists.
 */
function refuseUngatedModelSubcommand(
  sub: string,
  context: ICommandHostWorkspace,
): ICommandResult | undefined {
  if (context.getCommandInvocationSource() !== 'model') return undefined;
  const entry = WORKFLOWS_SUBCOMMANDS.find((candidate) => candidate.name === sub);
  if (entry === undefined || entry.modelInvocable !== false) return undefined;
  return {
    success: false,
    message:
      `The model may not run \`workflows ${sub}\`. It is registered as non-model-invocable ` +
      'because it executes or inspects an on-disk workflow, and a workflow can carry LLM, http and ' +
      'file nodes. Ask the operator to run it, or use `workflows create` to author one.',
  };
}

async function executeWorkflowsCommand(
  context: ICommandHostWorkspace,
  args: string,
  workspace: IWorkspaceLayout,
  providerDefinitions: readonly IProviderDefinition[],
  project: IWorkflowProject | undefined,
  settingsSources: readonly TSettingsSource[] | undefined,
): Promise<ICommandResult> {
  const { sub, rest } = splitSubcommand(args);

  // CMD-006: the per-subcommand `modelInvocable` flag was DECORATIVE — declared in the registry and
  // read by nothing. The framework gates the model path per TOP-LEVEL command name, and this
  // command is model-invocable (the model is meant to author workflows), so a model-issued
  // `workflows run <file>` inherited that and executed an arbitrary on-disk DAG — LLM, http and
  // file nodes — with no prompt.
  //
  // Enforced HERE rather than in the framework because the flag is per-subcommand and only this
  // dispatcher knows which subcommand an args string names. Read from the same registry that
  // declares it, so the two cannot drift: a subcommand added as `modelInvocable: false` is gated by
  // existing to be found, not by someone remembering to add a case.
  const refusal = refuseUngatedModelSubcommand(sub, context);
  if (refusal !== undefined) return refusal;

  const requiresProject = WORKFLOWS_SUBCOMMANDS.some((candidate) => candidate.name === sub);
  if (requiresProject && project === undefined) {
    return {
      success: false,
      message:
        'WorkspaceAuthorityRequired: /workflows requires an explicit workflow project capability.',
    };
  }

  const requiredProject = (): IWorkflowProject => assertWorkflowProject(project);

  try {
    switch (sub) {
      case '':
        return { success: true, message: USAGE };
      case 'create':
        return executeWorkflowsCreate(rest, requiredProject(), {
          workspace,
          providerDefinitions,
          ...(settingsSources === undefined ? {} : { settingsSources }),
        });
      case 'build':
        return executeWorkflowsBuild(rest, requiredProject(), {
          workspace,
          providerDefinitions,
          ...(settingsSources === undefined ? {} : { settingsSources }),
        });
      case 'list':
        return executeWorkflowsList(requiredProject(), workspace);
      case 'catalog':
        return executeWorkflowsCatalog(requiredProject(), workspace);
      case 'validate':
        return executeWorkflowsValidate(rest, requiredProject(), workspace);
      case 'run':
        return executeWorkflowsRun(rest, requiredProject(), workspace);
      default:
        return { success: false, message: `Unknown subcommand "${sub}".\n${USAGE}` };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
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
  project: IWorkflowProject | undefined,
  settingsSources: readonly TSettingsSource[] | undefined,
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
      executeWorkflowsCommand(
        context,
        args,
        workspace,
        providerDefinitions,
        project,
        settingsSources,
      ),
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
  /** Authority-backed project read/mutation view. Absence is Restricted. */
  readonly project?: IWorkflowProject;
  /** Explicit settings layers used by workflow authoring provider resolution. */
  readonly settingsSources?: readonly TSettingsSource[];
}

export function createWorkflowsCommandModule(
  deps: IWorkflowsCommandModuleDeps = {},
): ICommandModule {
  const workspace = deps.workspace ?? DEFAULT_WORKSPACE_LAYOUT;
  const providerDefinitions = deps.providerDefinitions ?? [];
  return {
    name: 'agent-command-workflows',
    commandSources: [new WorkflowsCommandSource()],
    systemCommands: [
      createWorkflowsSystemCommand(
        workspace,
        providerDefinitions,
        deps.project,
        deps.settingsSources,
      ),
    ],
  };
}
