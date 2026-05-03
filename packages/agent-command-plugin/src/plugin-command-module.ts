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
} from '@robota-sdk/agent-sdk';
import { executePluginCommand } from './plugin-command.js';

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

export class PluginManagerCommandSource implements ICommandSource {
  readonly name = 'plugin-manager';

  getCommands(): ICommand[] {
    return [createPluginCommandEntry()];
  }
}

export function createPluginCommandModule(): ICommandModule {
  return {
    name: 'agent-command-plugin',
    commandSources: [new PluginManagerCommandSource()],
    systemCommands: [createPluginSystemCommand()],
  };
}
