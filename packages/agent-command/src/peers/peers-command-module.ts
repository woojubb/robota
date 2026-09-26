import { executePeersCommand } from './peers-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createPeersCommandEntry(): ICommand {
  return {
    name: 'peers',
    displayName: 'Peers',
    description:
      "List the other live Robota sessions on this host and the user's other devices linked over the device mesh, send one a message, or send one a copy of a file. Returns the sessions and devices with the ids to address them by, or how a send ended. User-only: the model cannot run it; it answers a peer's message with its reply tool, and when the user wants to reach another session or device, suggest they run `/peers`.",
    source: 'peers',
    // The model does not enumerate the operator's other sessions. Discovery is an operator-facing
    // view of who is at the machine, which is a fact about the person and not about the task.
    // User-only: sends messages and files into other sessions; crossing a session boundary is the
    // user's call. The model sends a file only through `peer_send_file`, which asks every time.
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
    execute: (context, args) => executePeersCommand(context, args),
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
