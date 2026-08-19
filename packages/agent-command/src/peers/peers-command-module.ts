import { executePeersCommand } from './peers-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createPeersCommandEntry(): ICommand {
  return {
    name: 'peers',
    displayName: 'Peers',
    description: 'List the other live sessions on this host that this one can address',
    source: 'peers',
    // The model does not enumerate the operator's other sessions. Discovery is an operator-facing
    // view of who is at the machine, which is a fact about the person and not about the task.
    modelInvocable: false,
  };
}

function createPeersSystemCommand(): ISystemCommand {
  const entry = createPeersCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: (context) => executePeersCommand(context),
  };
}

export class PeersCommandSource implements ICommandSource {
  readonly name = 'peers';

  getCommands(): ICommand[] {
    return [createPeersCommandEntry()];
  }
}

export function createPeersCommandModule(): ICommandModule {
  return {
    name: 'agent-command-peers',
    commandSources: [new PeersCommandSource()],
    systemCommands: [createPeersSystemCommand()],
  };
}
