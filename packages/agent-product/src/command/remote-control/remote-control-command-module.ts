import { executeRemoteControlCommand } from './remote-control-command.js';
import { createSystemCommandFromEntry } from '../command-module-utils.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createRemoteControlCommandEntry(): ICommand {
  return {
    name: 'remote-control',
    displayName: 'Remote control',
    description:
      'Enable P2P remote control (pair a device to co-drive this session), or check status. Pairing and revoking run only for the operator at the host terminal; a connected surface can stop remote control and read its status, without the pairing link.',
    source: 'remote-control',
    // User-only: pairing and revoking devices are trust decisions. The command also refuses them when
    // they come from a connected surface rather than the operator at this terminal.
    modelInvocable: false,
    userInvocable: true,
    argumentHint: '[enable|stop|status|devices|revoke <device-id>]',
    subcommands: [
      { name: 'status', description: 'Show remote-control status', source: 'remote-control' },
      { name: 'devices', description: 'List trusted devices', source: 'remote-control' },
      {
        name: 'enable',
        description: 'Enable remote control and pair a device',
        source: 'remote-control',
      },
      { name: 'stop', description: 'Stop remote control', source: 'remote-control' },
      {
        name: 'revoke',
        description: 'Revoke a trusted device',
        source: 'remote-control',
        argumentHint: '<device-id>',
      },
    ],
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
