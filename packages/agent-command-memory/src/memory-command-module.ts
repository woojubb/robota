import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  MEMORY_COMMAND_ARGUMENT_HINT,
  MEMORY_COMMAND_DESCRIPTION,
  buildMemoryCommandSubcommands,
} from '@robota-sdk/agent-sdk';
import { executeMemoryCommand } from './memory-command.js';

export function createMemoryCommandEntry(): ICommand {
  return {
    name: 'memory',
    description: MEMORY_COMMAND_DESCRIPTION,
    source: 'memory',
    argumentHint: MEMORY_COMMAND_ARGUMENT_HINT,
    modelInvocable: true,
    safety: 'write',
    subcommands: buildMemoryCommandSubcommands(),
  };
}

function createMemorySystemCommand(): ISystemCommand {
  const entry = createMemoryCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: true,
    argumentHint: entry.argumentHint,
    safety: entry.safety,
    subcommands: entry.subcommands,
    execute: executeMemoryCommand,
  };
}

export class MemoryCommandSource implements ICommandSource {
  readonly name = 'memory';

  getCommands(): ICommand[] {
    return [createMemoryCommandEntry()];
  }
}

export function createMemoryCommandModule(): ICommandModule {
  return {
    name: 'agent-command-memory',
    commandSources: [new MemoryCommandSource()],
    systemCommands: [createMemorySystemCommand()],
  };
}
