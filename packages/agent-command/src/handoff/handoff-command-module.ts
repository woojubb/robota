import { executeHandoffCommand } from './handoff-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createHandoffCommandEntry(): ICommand {
  return {
    name: 'handoff',
    displayName: 'Hand off',
    description:
      'Push this conversation to another Robota session of the same user — on this machine or on another of their devices — after the operator confirms what stays behind (uncommitted changes, running processes; credentials never travel). The receiving operator must also accept; the session arrives saved, not started, and this one ends once it is saved there. With no argument it lists where the session could go. User-only: the model cannot run it; when the user wants to continue this work elsewhere, suggest they run `/handoff <session-or-device-id>`.',
    source: 'handoff',
    // User-only: a hand-off moves authority over the operator's work to another place, a decision
    // about where the person is, not about the task.
    modelInvocable: false,
    userInvocable: true,
    argumentHint: '[session-or-device-id]',
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
