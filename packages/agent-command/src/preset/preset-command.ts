import { selectAction } from '@robota-sdk/agent-core';
import { applyPresetToSession } from '@robota-sdk/agent-framework';
import { getPreset, listPresets, resolvePreset } from '@robota-sdk/agent-preset';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

/** Default active preset id reported when the runtime has no recorded active preset. */
const DEFAULT_ACTIVE_PRESET_ID = 'default';

/** Read the active preset id from the session, defaulting when the optional seam is absent. */
function readActivePresetId(context: ICommandHostContext): string {
  return context.getSession().getActivePresetId?.() ?? DEFAULT_ACTIVE_PRESET_ID;
}

/** Build the `/preset` listing: one line per preset, marking the active one with a `*` prefix. */
function formatPresetList(active: string): string {
  const lines = listPresets().map((preset) => {
    const marker = preset.id === active ? '* ' : '  ';
    return `${marker}${preset.id} — ${preset.title}: ${preset.description}`;
  });
  return ['Available presets:', ...lines].join('\n');
}

/** Build the rejection message for an unknown preset id, listing the valid ids. */
function formatUnknownPresetMessage(id: string): string {
  const ids = listPresets()
    .map((preset) => preset.id)
    .join(', ');
  return `Unknown preset: ${id}. Available: ${ids}`;
}

/** The `/preset` (or `/preset list`) listing result. */
function presetListResult(context: ICommandHostContext): ICommandResult {
  const active = readActivePresetId(context);
  return {
    message: formatPresetList(active),
    success: true,
    data: { presets: listPresets(), active },
  };
}

/**
 * Ask the user to pick a preset (CMD-004 inline ask). Returns the chosen id, or `undefined` when no
 * interactive renderer is attached or the user cancelled — the caller then shows the preset list.
 */
async function resolvePresetViaAsk(context: ICommandHostContext): Promise<string | undefined> {
  const ui = context.getUserInteraction?.();
  if (!ui) return undefined;
  const options = listPresets().map((preset) => ({
    value: preset.id,
    label: preset.id,
    description: preset.description,
  }));
  const response = await ui.ask(selectAction('preset', 'Select a preset', options));
  return response.type === 'answer' ? response.values[0] : undefined;
}

export async function executePresetCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  let id: string | undefined = args.trim().split(/\s+/)[0];

  if (id === 'list') {
    return presetListResult(context);
  }

  if (id === undefined || id.length === 0) {
    id = await resolvePresetViaAsk(context);
    if (id === undefined) {
      return presetListResult(context);
    }
  }

  if (getPreset(id) === undefined) {
    return {
      message: formatUnknownPresetMessage(id),
      success: false,
    };
  }

  const resolved = resolvePreset(id);
  await applyPresetToSession(context, id, resolved);
  return {
    message: `Switched to preset: ${id}`,
    success: true,
    data: { preset: id },
  };
}
