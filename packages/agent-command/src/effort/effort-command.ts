import { MODEL_EFFORT_VALUES, selectAction } from '@robota-sdk/agent-core';
import { parseModelEffort, resolveModelEffort } from '@robota-sdk/agent-framework';

import type {
  ICommandHostAdapterAccess,
  ICommandHostAdapters,
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
  IModelEffortResolution,
  TEffortSelection,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

const EFFORT_SELECTIONS: readonly TEffortSelection[] = ['auto', ...MODEL_EFFORT_VALUES];

function formatEffortMessage(resolution: {
  requested: TEffortSelection;
  effective: string;
  source: string;
  disposition: string;
}): string {
  return `Model effort: requested=${resolution.requested}, effective=${resolution.effective}, source=${resolution.source}, disposition=${resolution.disposition}.`;
}

async function askForEffort(
  context: ICommandHostUserInteraction,
): Promise<TEffortSelection | undefined> {
  const interaction = context.getUserInteraction();
  if (interaction === undefined) return undefined;
  const response = await interaction.ask(
    selectAction(
      'effort',
      'Select model effort',
      EFFORT_SELECTIONS.map((value) => ({ value, label: value })),
    ),
  );
  const selected = response.type === 'answer' ? response.values[0] : undefined;
  return parseModelEffort(selected, '/effort');
}

function readCurrentResolution(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
): IModelEffortResolution {
  const adapter = context.getCommandHostAdapters?.().effort;
  if (adapter !== undefined) return adapter.getResolution();
  const selection = context.getSession().getModelEffort();
  return resolveModelEffort({
    command: selection,
    modelDefault: selection === 'auto' ? 'high' : selection,
  });
}

function readAdapters(context: ICommandHostAdapterAccess): ICommandHostAdapters {
  return context.getCommandHostAdapters?.() ?? {};
}

function persistEffortSelection(
  context: ICommandHostAdapterAccess,
  selection: TEffortSelection,
): void {
  const settings = readAdapters(context).settings;
  if (settings === undefined || selection === 'max') return;
  const current = settings.read();
  if (selection === 'auto') {
    const { effort: _effort, ...withoutEffort } = current;
    settings.write(withoutEffort);
    return;
  }
  settings.write({ ...current, effort: selection });
}

export async function executeEffortCommand(
  context: ICommandHostAdapterAccess &
    ICommandHostSessionAccess &
    ICommandHostUserInteraction &
    ICommandHostWorkspace,
  args: string,
): Promise<ICommandResult> {
  let selection: TEffortSelection | undefined;
  try {
    selection = parseModelEffort(args.trim() || undefined, '/effort');
    if (selection === undefined) selection = await askForEffort(context);
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }

  const current = readCurrentResolution(context);
  if (selection === undefined) {
    return {
      message: formatEffortMessage(current),
      success: true,
      data: { effort: current },
    };
  }

  const adapter = readAdapters(context).effort;
  let resolution;
  try {
    resolution =
      adapter === undefined
        ? resolveModelEffort({ command: selection, modelDefault: current.effective })
        : await adapter.apply(selection, context.getSession());
    if (adapter === undefined) {
      await context.getSession().applyModelOptions({ effort: selection });
    }
    if (context.getCommandInvocationSource() === 'user') {
      persistEffortSelection(context, selection);
    }
  } catch (error) {
    return {
      message: `Model effort was not applied: ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }

  return {
    message: formatEffortMessage(resolution),
    success: true,
    data: { effort: resolution },
  };
}
