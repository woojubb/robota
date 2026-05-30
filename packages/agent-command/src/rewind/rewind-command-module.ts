import {
  REWIND_COMMAND_ARGUMENT_HINT,
  REWIND_COMMAND_DESCRIPTION,
  buildRewindCommandSubcommands,
} from '@robota-sdk/agent-framework';

import { executeRewindCommand } from './rewind-command.js';

import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-framework';

export function createRewindCommandEntry(): ICommand {
  return {
    name: 'rewind',
    displayName: 'Rewind History',
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
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
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
