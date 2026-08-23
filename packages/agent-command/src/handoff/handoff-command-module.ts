import { executeHandoffCommand } from './handoff-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createHandoffCommandEntry(): ICommand {
  return {
    name: 'handoff',
    displayName: 'Hand off',
    description: 'Move this session to another machine, after confirming what stays behind',
    source: 'handoff',
    // The model does not decide to give this session away. A hand-off moves AUTHORITY over the
    // operator's work to a different computer — it is a decision about where the person is sitting,
    // which is a fact about them and not about the task.
    modelInvocable: false,
  };
}

function createHandoffSystemCommand(): ISystemCommand {
  const entry = createHandoffCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: (context, args) => executeHandoffCommand(context, args),
  };
}

export class HandoffCommandSource implements ICommandSource {
  readonly name = 'handoff';

  getCommands(): ICommand[] {
    return [createHandoffCommandEntry()];
  }
}

export function createHandoffCommandModule(): ICommandModule {
  return {
    name: 'agent-command-handoff',
    commandSources: [new HandoffCommandSource()],
    systemCommands: [createHandoffSystemCommand()],
  };
}
