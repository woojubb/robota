import { MODEL_EFFORT_VALUES } from '@robota-sdk/agent-core';

import { executeEffortCommand } from './effort-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

const EFFORT_ARGUMENT_HINT = `auto | ${MODEL_EFFORT_VALUES.join(' | ')}`;

export function createEffortCommandEntry(): ICommand {
  return {
    name: 'effort',
    displayName: 'Model Effort',
    description: 'Show or change the model effort level',
    source: 'effort',
    argumentHint: EFFORT_ARGUMENT_HINT,
    modelInvocable: false,
  };
}

function createEffortSystemCommand(): ISystemCommand {
  const entry = createEffortCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    execute: executeEffortCommand,
  };
}

export class EffortCommandSource implements ICommandSource {
  readonly name = 'effort';

  getCommands(): ICommand[] {
    return [createEffortCommandEntry()];
  }
}

export function createEffortCommandModule(): ICommandModule {
  return {
    name: 'agent-command-effort',
    commandSources: [new EffortCommandSource()],
    systemCommands: [createEffortSystemCommand()],
  };
}
