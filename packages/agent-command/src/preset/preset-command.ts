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

export function executePresetCommand(context: ICommandHostContext, args: string): ICommandResult {
  const id = args.trim().split(/\s+/)[0];

  if (id === undefined || id.length === 0 || id === 'list') {
    const active = readActivePresetId(context);
    return {
      message: formatPresetList(active),
      success: true,
      data: { presets: listPresets(), active },
    };
  }

  if (getPreset(id) === undefined) {
    return {
      message: formatUnknownPresetMessage(id),
      success: false,
    };
  }

  const resolved = resolvePreset(id);
  applyPresetToSession(context, id, resolved);
  return {
    message: `Switched to preset: ${id}`,
    success: true,
    data: { preset: id },
  };
}
