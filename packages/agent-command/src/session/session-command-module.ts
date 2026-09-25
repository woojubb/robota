import {
  CLEAR_COMMAND_DESCRIPTION,
  COST_COMMAND_DESCRIPTION,
  RENAME_COMMAND_DESCRIPTION,
  RESUME_COMMAND_DESCRIPTION,
  VALIDATE_SESSION_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';

import {
  CD_COMMAND_DESCRIPTION,
  executeCdCommand,
  executeClearCommand,
  executeCostCommand,
  executeRenameCommand,
  executeResumeCommand,
  executeValidateSessionCommand,
} from './session-command.js';
import { createSystemCommandFromEntry } from '../command-module-utils.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createClearCommandEntry(): ICommand {
  return {
    name: 'clear',
    displayName: 'Clear History',
    description: CLEAR_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
    userInvocable: true,
  };
}

export function createRenameCommandEntry(): ICommand {
  return {
    name: 'rename',
    displayName: 'Rename Session',
    description: RENAME_COMMAND_DESCRIPTION,
    argumentHint: '<name>',
    source: 'session',
    modelInvocable: false,
    userInvocable: true,
  };
}

export function createCdCommandEntry(): ICommand {
  return {
    name: 'cd',
    displayName: 'Change Directory',
    description: CD_COMMAND_DESCRIPTION,
    argumentHint: '<directory>',
    source: 'session',
    // A move re-roots what every later tool call may touch; only the user decides it.
    modelInvocable: false,
    userInvocable: true,
  };
}

export function createResumeCommandEntry(): ICommand {
  return {
    name: 'resume',
    displayName: 'Resume Session',
    description: RESUME_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
    userInvocable: true,
  };
}

export function createCostCommandEntry(): ICommand {
  return {
    name: 'cost',
    displayName: 'Session Cost',
    description: COST_COMMAND_DESCRIPTION,
    argumentHint: '[budget [<amount>|clear]]',
    source: 'session',
    modelInvocable: false,
    userInvocable: true,
  };
}

export function createValidateSessionCommandEntry(): ICommand {
  return {
    name: 'validate-session',
    displayName: 'Validate Session',
    description: VALIDATE_SESSION_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
    userInvocable: true,
  };
}

function createClearSystemCommand(): ISystemCommand {
  const entry = createClearCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeClearCommand,
  });
}

function createRenameSystemCommand(): ISystemCommand {
  const entry = createRenameCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeRenameCommand,
  });
}

function createCdSystemCommand(): ISystemCommand {
  const entry = createCdCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeCdCommand,
  });
}

function createResumeSystemCommand(): ISystemCommand {
  const entry = createResumeCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeResumeCommand,
  });
}

function createCostSystemCommand(): ISystemCommand {
  const entry = createCostCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeCostCommand,
  });
}

function createValidateSessionSystemCommand(): ISystemCommand {
  const entry = createValidateSessionCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: executeValidateSessionCommand,
  });
}

export class SessionCommandSource implements ICommandSource {
  readonly name = 'session';

  getCommands(): ICommand[] {
    return [
      createClearCommandEntry(),
      createRenameCommandEntry(),
      createCdCommandEntry(),
      createResumeCommandEntry(),
      createCostCommandEntry(),
      createValidateSessionCommandEntry(),
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
      createCdSystemCommand(),
      createResumeSystemCommand(),
      createCostSystemCommand(),
      createValidateSessionSystemCommand(),
    ],
  };
}
