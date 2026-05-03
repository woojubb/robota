import type {
  ICommand,
  ICommandModule,
  ICommandSource,
  ISystemCommand,
} from '@robota-sdk/agent-sdk';
import { PERMISSIONS_COMMAND_DESCRIPTION } from '@robota-sdk/agent-sdk';
import { executePermissionsCommand } from './permissions-command.js';

export function createPermissionsCommandEntry(): ICommand {
  return {
    name: 'permissions',
    description: PERMISSIONS_COMMAND_DESCRIPTION,
    source: 'permissions',
    modelInvocable: false,
  };
}

function createPermissionsSystemCommand(): ISystemCommand {
  const entry = createPermissionsCommandEntry();
  return {
    name: entry.name,
    description: entry.description,
    userInvocable: true,
    modelInvocable: false,
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
