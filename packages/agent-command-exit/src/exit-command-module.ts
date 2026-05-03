import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { EXIT_COMMAND_DESCRIPTION } from '@robota-sdk/agent-sdk';
import { executeExitCommand } from './exit-command.js';

export function createExitCommandEntry(): ICommand {
  return {
    name: 'exit',
    description: EXIT_COMMAND_DESCRIPTION,
    source: 'exit',
    modelInvocable: false,
  };
}

function createExitSystemCommand(): ISystemCommand {
  const entry = createExitCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeExitCommand,
  };
}

export class ExitCommandSource implements ICommandSource {
  readonly name = 'exit';

  getCommands(): ICommand[] {
    return [createExitCommandEntry()];
  }
}

export function createExitCommandModule(): ICommandModule {
  return {
    name: 'agent-command-exit',
    commandSources: [new ExitCommandSource()],
    systemCommands: [createExitSystemCommand()],
  };
}
