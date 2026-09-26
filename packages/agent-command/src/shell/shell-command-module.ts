/**
 * TERM-003: `/shell` command module — a framework-level consumer of the terminal-handoff capability.
 */
import { executeShellCommand, SHELL_COMMAND_DESCRIPTION } from './shell-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createShellCommandEntry(): ICommand {
  return {
    name: 'shell',
    displayName: 'Shell',
    description: SHELL_COMMAND_DESCRIPTION,
    source: 'shell',
    // User-only: the user's own shell passthrough; the model has its permission-gated shell tool.
    modelInvocable: false,
    // It takes over the terminal the user sits at, so that terminal runs it, even when attached.
    runner: 'client',
    surfaces: ['terminal'],
  };
}

function createShellSystemCommand(executable?: string): ISystemCommand {
  const entry = createShellCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: true,
    userInvocable: true,
    modelInvocable: false,
    runner: entry.runner,
    surfaces: entry.surfaces,
    lifecycle: 'inline',
    execute: (context, args) => executeShellCommand(context, args, executable),
  };
}

export class ShellCommandSource implements ICommandSource {
  readonly name = 'shell';

  getCommands(): ICommand[] {
    return [createShellCommandEntry()];
  }
}

export function createShellCommandModule(executable?: string): ICommandModule {
  return {
    name: 'agent-command-shell',
    commandSources: [new ShellCommandSource()],
    systemCommands: [createShellSystemCommand(executable)],
  };
}
