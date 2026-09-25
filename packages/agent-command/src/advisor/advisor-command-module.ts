import { executeAdvisorCommand } from './advisor-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createAdvisorCommandEntry(): ICommand {
  return {
    name: 'advisor',
    displayName: 'Advisor',
    description: 'Show, set, or turn off the model the main model can consult for advice',
    source: 'advisor',
    argumentHint: '<profile> | <profile>:<model> | off',
    modelInvocable: false,
  };
}

function createAdvisorSystemCommand(): ISystemCommand {
  const entry = createAdvisorCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    lifecycle: 'inline',
    execute: executeAdvisorCommand,
  };
}

export class AdvisorCommandSource implements ICommandSource {
  readonly name = 'advisor';

  getCommands(): ICommand[] {
    return [createAdvisorCommandEntry()];
  }
}

export function createAdvisorCommandModule(): ICommandModule {
  return {
    name: 'agent-command-advisor',
    commandSources: [new AdvisorCommandSource()],
    systemCommands: [createAdvisorSystemCommand()],
  };
}
