import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  USER_LOCAL_COMMAND_ARGUMENT_HINT,
  USER_LOCAL_COMMAND_DESCRIPTION,
  executeUserLocalCommand,
} from './user-local-command.js';

export function createUserLocalCommandEntry(): ICommand {
  return {
    name: 'user-local',
    description: USER_LOCAL_COMMAND_DESCRIPTION,
    source: 'user-local',
    argumentHint: USER_LOCAL_COMMAND_ARGUMENT_HINT,
    modelInvocable: false,
    safety: 'read-only',
    subcommands: [
      {
        name: 'storage',
        description: 'Inspect user-local storage categories',
        source: 'user-local',
      },
    ],
  };
}

function createUserLocalSystemCommand(): ISystemCommand {
  const entry = createUserLocalCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    safety: entry.safety,
    subcommands: entry.subcommands,
    execute: executeUserLocalCommand,
  };
}

export class UserLocalCommandSource implements ICommandSource {
  readonly name = 'user-local';

  getCommands(): ICommand[] {
    return [createUserLocalCommandEntry()];
  }
}

export function createUserLocalCommandModule(): ICommandModule {
  return {
    name: 'agent-command-user-local',
    commandSources: [new UserLocalCommandSource()],
    systemCommands: [createUserLocalSystemCommand()],
  };
}
