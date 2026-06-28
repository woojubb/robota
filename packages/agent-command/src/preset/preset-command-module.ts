import { listPresets } from '@robota-sdk/agent-preset';

import { executePresetCommand } from './preset-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

const PRESET_COMMAND_DESCRIPTION = 'List presets or switch the active preset';
const PRESET_ARGUMENT_HINT = 'list | <preset-id>';

/** Build one subcommand per registered preset id (mirrors the permission-mode subcommands). */
function buildPresetSubcommands(source = 'preset'): ICommand[] {
  return listPresets().map((preset) => ({
    name: preset.id,
    description: preset.description,
    source,
  }));
}

export function createPresetCommandEntry(): ICommand {
  return {
    name: 'preset',
    displayName: 'Agent Preset',
    description: PRESET_COMMAND_DESCRIPTION,
    source: 'preset',
    argumentHint: PRESET_ARGUMENT_HINT,
    subcommands: buildPresetSubcommands('preset'),
    modelInvocable: false,
  };
}

function createPresetSystemCommand(): ISystemCommand {
  const entry = createPresetCommandEntry();
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
    execute: executePresetCommand,
  };
}

export class PresetCommandSource implements ICommandSource {
  readonly name = 'preset';

  getCommands(): ICommand[] {
    return [createPresetCommandEntry()];
  }
}

export function createPresetCommandModule(): ICommandModule {
  return {
    name: 'agent-command-preset',
    commandSources: [new PresetCommandSource()],
    systemCommands: [createPresetSystemCommand()],
  };
}
