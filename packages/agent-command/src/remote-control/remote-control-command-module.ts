import { executeRemoteControlCommand } from './remote-control-command.js';
import { createSystemCommandFromEntry } from '../command-module-utils.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createRemoteControlCommandEntry(): ICommand {
  return {
    name: 'remote-control',
    displayName: 'Remote control',
    description:
      'Enable P2P remote control (pair a device to co-drive this session), or check status',
    source: 'remote-control',
    modelInvocable: false,
    userInvocable: true,
    argumentHint: '[enable|stop|status|devices|revoke <device-id>]',
  };
}

function createRemoteControlSystemCommand(): ISystemCommand {
  const entry = createRemoteControlCommandEntry();
  return createSystemCommandFromEntry(entry, {
    requiresPermission: false,
    lifecycle: 'inline',
    execute: (context, args) => executeRemoteControlCommand(context, args),
  });
}

export class RemoteControlCommandSource implements ICommandSource {
  readonly name = 'remote-control';

  getCommands(): ICommand[] {
    return [createRemoteControlCommandEntry()];
  }
}

export function createRemoteControlCommandModule(): ICommandModule {
  return {
    name: 'agent-command-remote-control',
    commandSources: [new RemoteControlCommandSource()],
    systemCommands: [createRemoteControlSystemCommand()],
  };
}
