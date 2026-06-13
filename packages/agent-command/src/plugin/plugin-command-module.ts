import {
  buildPluginCommandSubcommands,
  PLUGIN_COMMAND_ARGUMENT_HINT,
  PLUGIN_COMMAND_DESCRIPTION,
  RELOAD_PLUGINS_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';

import { executePluginCommand, executeReloadPluginsCommand } from './plugin-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createPluginCommandEntry(): ICommand {
  return {
    name: 'plugin',
    displayName: 'Plugins',
    description: PLUGIN_COMMAND_DESCRIPTION,
    source: 'plugin-manager',
    modelInvocable: false,
    argumentHint: PLUGIN_COMMAND_ARGUMENT_HINT,
    subcommands: buildPluginCommandSubcommands(),
  };
}

export function createReloadPluginsCommandEntry(): ICommand {
  return {
    name: 'reload-plugins',
    displayName: 'Reload Plugins',
    description: RELOAD_PLUGINS_COMMAND_DESCRIPTION,
    source: 'plugin-manager',
    modelInvocable: false,
  };
}

function createPluginSystemCommand(): ISystemCommand {
  const entry = createPluginCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    subcommands: entry.subcommands,
    execute: executePluginCommand,
  };
}

function createReloadPluginsSystemCommand(): ISystemCommand {
  const entry = createReloadPluginsCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeReloadPluginsCommand,
  };
}

export class PluginManagerCommandSource implements ICommandSource {
  readonly name = 'plugin-manager';

  getCommands(): ICommand[] {
    return [createPluginCommandEntry(), createReloadPluginsCommandEntry()];
  }
}

export function createPluginCommandModule(): ICommandModule {
  return {
    name: 'agent-command-plugin',
    commandSources: [new PluginManagerCommandSource()],
    systemCommands: [createPluginSystemCommand(), createReloadPluginsSystemCommand()],
  };
}
