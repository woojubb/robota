import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  buildPluginCommandSubcommands,
  PLUGIN_COMMAND_ARGUMENT_HINT,
  PLUGIN_COMMAND_DESCRIPTION,
  RELOAD_PLUGINS_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-sdk';
import { executePluginCommand, executeReloadPluginsCommand } from './plugin-command.js';

export function createPluginCommandEntry(): ICommand {
  return {
    name: 'plugin',
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
    description: RELOAD_PLUGINS_COMMAND_DESCRIPTION,
    source: 'plugin-manager',
    modelInvocable: false,
  };
}

function createPluginSystemCommand(): ISystemCommand {
  const entry = createPluginCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
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
    description: entry.description,
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
