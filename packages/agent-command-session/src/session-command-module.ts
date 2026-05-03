import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import {
  CLEAR_COMMAND_DESCRIPTION,
  COST_COMMAND_DESCRIPTION,
  RENAME_COMMAND_DESCRIPTION,
  RESUME_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-sdk';
import {
  executeClearCommand,
  executeCostCommand,
  executeRenameCommand,
  executeResumeCommand,
} from './session-command.js';

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

export function createResumeCommandEntry(): ICommand {
  return {
    name: 'resume',
    description: RESUME_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

export function createCostCommandEntry(): ICommand {
  return {
    name: 'cost',
    description: COST_COMMAND_DESCRIPTION,
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

function createResumeSystemCommand(): ISystemCommand {
  const entry = createResumeCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeResumeCommand,
  };
}

function createCostSystemCommand(): ISystemCommand {
  const entry = createCostCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeCostCommand,
  };
}

export class SessionCommandSource implements ICommandSource {
  readonly name = 'session';

  getCommands(): ICommand[] {
    return [
      createClearCommandEntry(),
      createRenameCommandEntry(),
      createResumeCommandEntry(),
      createCostCommandEntry(),
    ];
  }
}

export function createSessionCommandModule(): ICommandModule {
  return {
    name: 'agent-command-session',
    commandSources: [new SessionCommandSource()],
    systemCommands: [
      createClearSystemCommand(),
      createRenameSystemCommand(),
      createResumeSystemCommand(),
      createCostSystemCommand(),
    ],
  };
}
