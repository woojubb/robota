import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { executeResetCommand } from './reset-command.js';

const RESET_COMMAND_DESCRIPTION = 'Delete settings';

export function createResetCommandEntry(): ICommand {
  return {
    name: 'reset',
    description: RESET_COMMAND_DESCRIPTION,
    source: 'reset',
    modelInvocable: false,
  };
}

function createResetSystemCommand(): ISystemCommand {
  const entry = createResetCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeResetCommand,
  };
}

export class ResetCommandSource implements ICommandSource {
  readonly name = 'reset';

  getCommands(): ICommand[] {
    return [createResetCommandEntry()];
  }
}

export function createResetCommandModule(): ICommandModule {
  return {
    name: 'agent-command-reset',
    commandSources: [new ResetCommandSource()],
    systemCommands: [createResetSystemCommand()],
  };
}
