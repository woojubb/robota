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
    // User-only: wiping the conversation is the user's decision.
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
    // User-only: the session's name is the user's label; UI-only.
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
    // User-only: switching to another session is the user's decision.
    modelInvocable: false,
    userInvocable: true,
  };
}

export function createCostCommandEntry(): ICommand {
  return {
    name: 'cost',
    displayName: 'Session Cost',
    description: COST_COMMAND_DESCRIPTION,
    // Model-invocable for the read-only report only: the model can weigh cost before an expensive
    // step. The monthly budget is the user's spending decision, so `budget` stays user-only.
    modelDescription:
      'Report this session’s token usage and estimated cost. Use it before an expensive step (a ' +
      'large refactor, many subagents) or when the user asks what the session has cost. Returns ' +
      'the message count, input/output token totals and the estimated USD cost, with the remaining ' +
      'monthly budget when one is set. Setting or clearing the budget is the user’s decision: suggest `/cost budget <amount>`.',
    argumentHint: '[budget [<amount>|clear]]',
    // The bare `/cost` is the report, so choosing it from a menu runs it.
    runsBare: true,
    source: 'session',
    modelInvocable: true,
    userInvocable: true,
    subcommands: [
      {
        name: 'budget',
        description: 'Show, set, or clear the monthly budget',
        argumentHint: '[<amount>|clear]',
        source: 'session',
        modelInvocable: false,
      },
    ],
  };
}

export function createValidateSessionCommandEntry(): ICommand {
  return {
    name: 'validate-session',
    displayName: 'Validate Session',
    description: VALIDATE_SESSION_COMMAND_DESCRIPTION,
    source: 'session',
    // User-only: a diagnostic of the replay log for the user; nothing the model acts on.
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
