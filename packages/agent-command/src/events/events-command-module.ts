import { executeEventsCommand } from './events-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createEventsCommandEntry(): ICommand {
  return {
    name: 'events',
    displayName: 'Events',
    description:
      "List this session's external event grants (each grant's label, whether it pins a subject or a client, whether it is open or revoked, and its counts of accepted, refused and settled events), or revoke one with `/events revoke <grant-id>`. Returns the grants, or whether the revocation took effect. User-only: the model cannot run it; when the user wants to stop events from outside, suggest `/events revoke <grant-id>`.",
    source: 'events',
    argumentHint: '[revoke <grant-id>]',
    // User-only: a grant is the owner's standing decision that someone outside may put turns into
    // this session. Withdrawing it is the owner's call too, and listing it lives on the same command.
    modelInvocable: false,
  };
}

function createEventsSystemCommand(): ISystemCommand {
  const entry = createEventsCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    ...(entry.argumentHint !== undefined ? { argumentHint: entry.argumentHint } : {}),
    lifecycle: 'inline',
    execute: (context, args) => executeEventsCommand(context, args),
  };
}

export class EventsCommandSource implements ICommandSource {
  readonly name = 'events';

  getCommands(): ICommand[] {
    return [createEventsCommandEntry()];
  }
}

export function createEventsCommandModule(): ICommandModule {
  return {
    name: 'agent-command-events',
    commandSources: [new EventsCommandSource()],
    systemCommands: [createEventsSystemCommand()],
  };
}
