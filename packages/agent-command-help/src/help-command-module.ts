import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { HELP_COMMAND_DESCRIPTION } from '@robota-sdk/agent-sdk';
import { executeHelpCommand } from './help-command.js';

export function createHelpCommandEntry(): ICommand {
  return {
    name: 'help',
    description: HELP_COMMAND_DESCRIPTION,
    source: 'help',
    modelInvocable: false,
  };
}

function createHelpSystemCommand(): ISystemCommand {
  const entry = createHelpCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
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
