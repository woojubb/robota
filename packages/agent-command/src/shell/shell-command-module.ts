/**
 * TERM-003: `/shell` command module — a framework-level consumer of the terminal-handoff capability.
 */
import { executeShellCommand, SHELL_COMMAND_DESCRIPTION } from './shell-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createShellCommandEntry(): ICommand {
  return {
    name: 'shell',
    displayName: 'Shell',
    description: SHELL_COMMAND_DESCRIPTION,
    source: 'shell',
    modelInvocable: false,
  };
}

function createShellSystemCommand(): ISystemCommand {
  const entry = createShellCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: true,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeShellCommand,
  };
}

export class ShellCommandSource implements ICommandSource {
  readonly name = 'shell';

  getCommands(): ICommand[] {
    return [createShellCommandEntry()];
  }
}

export function createShellCommandModule(): ICommandModule {
  return {
    name: 'agent-command-shell',
    commandSources: [new ShellCommandSource()],
    systemCommands: [createShellSystemCommand()],
  };
}
