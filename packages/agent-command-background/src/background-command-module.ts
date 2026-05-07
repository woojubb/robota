import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  BACKGROUND_COMMAND_DESCRIPTION,
  buildBackgroundCommandSubcommands,
} from '@robota-sdk/agent-sdk';
import { executeBackgroundCommand } from './background-command.js';

export function createBackgroundCommandEntry(): ICommand {
  return {
    name: 'background',
    description: BACKGROUND_COMMAND_DESCRIPTION,
    source: 'background',
    modelInvocable: false,
    subcommands: buildBackgroundCommandSubcommands(),
  };
}

function createBackgroundSystemCommand(): ISystemCommand {
  const entry = createBackgroundCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    subcommands: entry.subcommands,
    execute: executeBackgroundCommand,
  };
}

export class BackgroundCommandSource implements ICommandSource {
  readonly name = 'background';

  getCommands(): ICommand[] {
    return [createBackgroundCommandEntry()];
  }
}

export function createBackgroundCommandModule(): ICommandModule {
  return {
    name: 'agent-command-background',
    commandSources: [new BackgroundCommandSource()],
    systemCommands: [createBackgroundSystemCommand()],
  };
}
