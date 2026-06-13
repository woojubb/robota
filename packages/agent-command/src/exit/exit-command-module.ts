import { EXIT_COMMAND_DESCRIPTION } from '@robota-sdk/agent-framework';

import { executeExitCommand } from './exit-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type {
  ICommand,
  ICommandInteractionHint,
  ICommandSource,
} from '@robota-sdk/agent-interface-transport';

export function createExitCommandEntry(): ICommand {
  return {
    name: 'exit',
    displayName: 'Exit Session',
    description: EXIT_COMMAND_DESCRIPTION,
    source: 'exit',
    modelInvocable: false,
  };
}

function createExitSystemCommand(): ISystemCommand {
  const entry = createExitCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: true,
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

const EXIT_INTERACTION_HINTS: Record<string, ICommandInteractionHint> = {
  exit: { type: 'confirm', message: 'Exit the session?' },
};

export function createExitCommandModule(): ICommandModule {
  return {
    name: 'agent-command-exit',
    commandSources: [new ExitCommandSource()],
    systemCommands: [createExitSystemCommand()],
    interactionHints: EXIT_INTERACTION_HINTS,
  };
}
