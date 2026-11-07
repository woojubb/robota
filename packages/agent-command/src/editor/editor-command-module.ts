/**
 * TERM-004: `/editor` command module — a framework-level consumer of the terminal-handoff capability.
 */
import { EDITOR_COMMAND_DESCRIPTION, executeEditorCommand } from './editor-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createEditorCommandEntry(unavailableMessage?: string): ICommand {
  return {
    name: 'editor',
    displayName: 'Editor',
    description: unavailableMessage ?? EDITOR_COMMAND_DESCRIPTION,
    source: 'editor',
    // User-only: opens the user's terminal editor; UI-only.
    modelInvocable: false,
    // It takes over the terminal the user sits at, so that terminal runs it, even when attached.
    runner: 'client',
    surfaces: ['terminal'],
  };
}

function createEditorSystemCommand(
  temporaryDirectoryPrefix?: string,
  unavailableMessage?: string,
): ISystemCommand {
  const entry = createEditorCommandEntry(unavailableMessage);
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    runner: entry.runner,
    surfaces: entry.surfaces,
    lifecycle: 'inline',
    execute: (context, args) =>
      unavailableMessage === undefined
        ? executeEditorCommand(context, args, temporaryDirectoryPrefix)
        : { message: unavailableMessage, success: false },
  };
}

export class EditorCommandSource implements ICommandSource {
  readonly name = 'editor';

  constructor(private readonly unavailableMessage?: string) {}

  getCommands(): ICommand[] {
    return [createEditorCommandEntry(this.unavailableMessage)];
  }
}

export function createEditorCommandModule(
  temporaryDirectoryPrefix?: string,
  unavailableMessage?: string,
): ICommandModule {
  return {
    name: 'agent-command-editor',
    commandSources: [new EditorCommandSource(unavailableMessage)],
    systemCommands: [createEditorSystemCommand(temporaryDirectoryPrefix, unavailableMessage)],
  };
}
