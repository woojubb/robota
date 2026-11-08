import {
  USER_LOCAL_COMMAND_ARGUMENT_HINT,
  USER_LOCAL_COMMAND_DESCRIPTION,
  executeUserLocalCommand,
} from './user-local-command.js';

import type { IFileSystemAsync } from '@robota-sdk/agent-core';
import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface/command';

export function createUserLocalCommandEntry(): ICommand {
  return {
    name: 'user-local',
    displayName: 'User Config',
    description: USER_LOCAL_COMMAND_DESCRIPTION,
    source: 'user-local',
    argumentHint: USER_LOCAL_COMMAND_ARGUMENT_HINT,
    // User-only: the user's private cross-project storage.
    modelInvocable: false,
    safety: 'read-only',
    subcommands: [
      {
        name: 'storage',
        description: 'Inspect user-local storage categories',
        source: 'user-local',
      },
      {
        name: 'memory',
        description: 'Inspect and manage user-local memory items',
        source: 'user-local',
      },
    ],
  };
}

function createUserLocalSystemCommand(
  storageRoot: string,
  fsAsync: IFileSystemAsync | undefined,
): ISystemCommand {
  const entry = createUserLocalCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    argumentHint: entry.argumentHint,
    safety: entry.safety,
    subcommands: entry.subcommands,
    execute: (context, rawArgs) => executeUserLocalCommand(context, rawArgs, storageRoot, fsAsync),
  };
}

export class UserLocalCommandSource implements ICommandSource {
  readonly name = 'user-local';

  getCommands(): ICommand[] {
    return [createUserLocalCommandEntry()];
  }
}

/**
 * Register `/user-local` over the host's storage root. The package has no host default for `fsAsync`:
 * a Node host passes `NodeFileSystemAsync` from `@robota-sdk/agent-framework/node`, and without it the
 * command is listed and says it is unavailable.
 */
export function createUserLocalCommandModule(
  storageRoot: string,
  fsAsync?: IFileSystemAsync,
): ICommandModule {
  return {
    name: 'agent-command-user-local',
    commandSources: [new UserLocalCommandSource()],
    systemCommands: [createUserLocalSystemCommand(storageRoot, fsAsync)],
  };
}
