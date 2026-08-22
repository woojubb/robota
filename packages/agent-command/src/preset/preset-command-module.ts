import { createPresetRegistry } from '@robota-sdk/agent-preset';

import { executePresetCommand } from './preset-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

const PRESET_COMMAND_DESCRIPTION = 'List presets or switch the active preset';
const PRESET_ARGUMENT_HINT = 'list | <preset-id>';

/**
 * Build one subcommand per registered preset id (mirrors the permission-mode subcommands).
 *
 * ARCH-009 LIMIT, stated rather than left implicit: this lists the BUILT-INS, because it builds a
 * STATIC catalog entry at module-construction time and has no `ICommandHostContext` to reach a
 * host-supplied registry. `/preset`'s own execution — listing, lookup, resolution — goes through the
 * host's registry, so an embedded host with its own presets resolves and applies correctly; only the
 * pre-computed subcommand hints for tab-completion omit that host's external presets.
 *
 * What ARCH-009 changed here is what the limit COSTS. This used to read a process-wide mutable
 * registry, so the hints a host saw depended on which other host had loaded presets first. They are
 * now the built-ins and nothing else — wrong the same way for everyone, and never someone else's.
 *
 * Closing it needs the catalog to be built per host rather than per module, which is a change to how
 * command modules are constructed and not to this file. Filed separately.
 */
function buildPresetSubcommands(source = 'preset'): ICommand[] {
  return createPresetRegistry()
    .listPresets()
    .map((preset) => ({
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
