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

/**
 * #3282 §2 — the plain label for each effort selection, shared by the outcome text below and the
 * TUI/GUI pickers, so `/effort xhigh` and a person reading "Extra high" agree on what happened.
 */
export const EFFORT_LEVEL_LABELS: Readonly<Record<TEffortSelection, string>> = {
  auto: 'Auto',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Maximum',
};

/**
 * Plain outcome text (#3282 §2), replacing the earlier `Model effort: requested=…, effective=…,
 * source=…, disposition=…` internal-field dump. `not-applied` means the model has no matching native
 * control at all — the earlier fields carried no information a person could act on for that case, so
 * it gets its own plain sentence instead of a label.
 */
function formatEffortMessage(resolution: {
  requested: TEffortSelection;
  disposition: string;
}): string {
  if (resolution.disposition === 'not-applied') {
    return "This model doesn't support effort levels, so it will use its default.";
  }
  return `Effort: ${EFFORT_LEVEL_LABELS[resolution.requested]}`;
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
      EFFORT_SELECTIONS.map((value) => ({ value, label: EFFORT_LEVEL_LABELS[value] })),
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
