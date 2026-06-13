import {
  buildPermissionModeSubcommands,
  PERMISSION_MODE_ARGUMENT_HINT,
  PERMISSIONS_COMMAND_DESCRIPTION,
} from '@robota-sdk/agent-framework';

import { executePermissionsCommand } from './permissions-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createPermissionsCommandEntry(): ICommand {
  return {
    name: 'permissions',
    displayName: 'Permissions',
    description: PERMISSIONS_COMMAND_DESCRIPTION,
    source: 'permissions',
    argumentHint: PERMISSION_MODE_ARGUMENT_HINT,
    subcommands: buildPermissionModeSubcommands('permissions'),
    modelInvocable: false,
  };
}

function createPermissionsSystemCommand(): ISystemCommand {
  const entry = createPermissionsCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: true,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    subcommands: entry.subcommands,
    lifecycle: 'inline',
    execute: executePermissionsCommand,
  };
}

export class PermissionsCommandSource implements ICommandSource {
  readonly name = 'permissions';

  getCommands(): ICommand[] {
    return [createPermissionsCommandEntry()];
  }
}

export function createPermissionsCommandModule(): ICommandModule {
  return {
    name: 'agent-command-permissions',
    commandSources: [new PermissionsCommandSource()],
    systemCommands: [createPermissionsSystemCommand()],
  };
}
