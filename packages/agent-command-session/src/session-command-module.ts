import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { CLEAR_COMMAND_DESCRIPTION, RENAME_COMMAND_DESCRIPTION } from '@robota-sdk/agent-sdk';
import { executeClearCommand, executeRenameCommand } from './session-command.js';

export function createClearCommandEntry(): ICommand {
  return {
    name: 'clear',
    description: CLEAR_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

export function createRenameCommandEntry(): ICommand {
  return {
    name: 'rename',
    description: RENAME_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

function createClearSystemCommand(): ISystemCommand {
  const entry = createClearCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeClearCommand,
  };
}

function createRenameSystemCommand(): ISystemCommand {
  const entry = createRenameCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeRenameCommand,
  };
}

export class SessionCommandSource implements ICommandSource {
  readonly name = 'session';

  getCommands(): ICommand[] {
    return [createClearCommandEntry(), createRenameCommandEntry()];
  }
}

export function createSessionCommandModule(): ICommandModule {
  return {
    name: 'agent-command-session',
    commandSources: [new SessionCommandSource()],
    systemCommands: [createClearSystemCommand(), createRenameSystemCommand()],
  };
}
