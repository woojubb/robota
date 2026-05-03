import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  REWIND_COMMAND_ARGUMENT_HINT,
  REWIND_COMMAND_DESCRIPTION,
  buildRewindCommandSubcommands,
} from '@robota-sdk/agent-sdk';
import { executeRewindCommand } from './rewind-command.js';

export function createRewindCommandEntry(): ICommand {
  return {
    name: 'rewind',
    description: REWIND_COMMAND_DESCRIPTION,
    source: 'rewind',
    argumentHint: REWIND_COMMAND_ARGUMENT_HINT,
    modelInvocable: false,
    safety: 'write',
    subcommands: buildRewindCommandSubcommands(),
  };
}

function createRewindSystemCommand(): ISystemCommand {
  const entry = createRewindCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    argumentHint: entry.argumentHint,
    userInvocable: true,
    modelInvocable: false,
    safety: 'write',
    subcommands: entry.subcommands,
    execute: executeRewindCommand,
  };
}

export class RewindCommandSource implements ICommandSource {
  readonly name = 'rewind';

  getCommands(): ICommand[] {
    return [createRewindCommandEntry()];
  }
}

export function createRewindCommandModule(): ICommandModule {
  return {
    name: 'agent-command-rewind',
    commandSources: [new RewindCommandSource()],
    systemCommands: [createRewindSystemCommand()],
  };
}
