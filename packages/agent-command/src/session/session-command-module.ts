import {
  CLEAR_COMMAND_DESCRIPTION,
  COST_COMMAND_DESCRIPTION,
  RENAME_COMMAND_DESCRIPTION,
  RESUME_COMMAND_DESCRIPTION,
  VALIDATE_SESSION_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';

import {
  executeClearCommand,
  executeCostCommand,
  executeRenameCommand,
  executeResumeCommand,
  executeValidateSessionCommand,
} from './session-command.js';

import type {
  ICommand,
  ICommandInteractionHint,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-framework';

export function createClearCommandEntry(): ICommand {
  return {
    name: 'clear',
    displayName: 'Clear History',
    description: CLEAR_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

export function createRenameCommandEntry(): ICommand {
  return {
    name: 'rename',
    displayName: 'Rename Session',
    description: RENAME_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

export function createResumeCommandEntry(): ICommand {
  return {
    name: 'resume',
    displayName: 'Resume Session',
    description: RESUME_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

export function createCostCommandEntry(): ICommand {
  return {
    name: 'cost',
    displayName: 'Session Cost',
    description: COST_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

export function createValidateSessionCommandEntry(): ICommand {
  return {
    name: 'validate-session',
    displayName: 'Validate Session',
    description: VALIDATE_SESSION_COMMAND_DESCRIPTION,
    source: 'session',
    modelInvocable: false,
  };
}

function createClearSystemCommand(): ISystemCommand {
  const entry = createClearCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
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
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
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
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
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
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeCostCommand,
  };
}

function createValidateSessionSystemCommand(): ISystemCommand {
  const entry = createValidateSessionCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeValidateSessionCommand,
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
      createValidateSessionCommandEntry(),
    ];
  }
}

const SESSION_INTERACTION_HINTS: Record<string, ICommandInteractionHint> = {
  clear: { type: 'confirm', message: 'Clear conversation history?' },
};

export function createSessionCommandModule(): ICommandModule {
  return {
    name: 'agent-command-session',
    commandSources: [new SessionCommandSource()],
    systemCommands: [
      createClearSystemCommand(),
      createRenameSystemCommand(),
      createResumeSystemCommand(),
      createCostSystemCommand(),
      createValidateSessionSystemCommand(),
    ],
    interactionHints: SESSION_INTERACTION_HINTS,
  };
}
