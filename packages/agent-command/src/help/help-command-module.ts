import { HELP_COMMAND_DESCRIPTION } from '@robota-sdk/agent-framework';

import { executeHelpCommand } from './help-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createHelpCommandEntry(): ICommand {
  return {
    name: 'help',
    displayName: 'Help',
    description: HELP_COMMAND_DESCRIPTION,
    source: 'help',
    modelInvocable: false,
  };
}

function createHelpSystemCommand(): ISystemCommand {
  const entry = createHelpCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeHelpCommand,
  };
}

export class HelpCommandSource implements ICommandSource {
  readonly name = 'help';

  getCommands(): ICommand[] {
    return [createHelpCommandEntry()];
  }
}

export function createHelpCommandModule(): ICommandModule {
  return {
    name: 'agent-command-help',
    commandSources: [new HelpCommandSource()],
    systemCommands: [createHelpSystemCommand()],
  };
}
