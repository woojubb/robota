/**
 * TERM-004: `/editor` command module — a framework-level consumer of the terminal-handoff capability.
 */
import { EDITOR_COMMAND_DESCRIPTION, executeEditorCommand } from './editor-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createEditorCommandEntry(): ICommand {
  return {
    name: 'editor',
    displayName: 'Editor',
    description: EDITOR_COMMAND_DESCRIPTION,
    source: 'editor',
    // User-only: opens the user's terminal editor; UI-only.
    modelInvocable: false,
    // It takes over the terminal the user sits at, so that terminal runs it, even when attached.
    runner: 'client',
    surfaces: ['terminal'],
  };
}

function createEditorSystemCommand(temporaryDirectoryPrefix?: string): ISystemCommand {
  const entry = createEditorCommandEntry();
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
    execute: (context, args) => executeEditorCommand(context, args, temporaryDirectoryPrefix),
  };
}

export class EditorCommandSource implements ICommandSource {
  readonly name = 'editor';

  getCommands(): ICommand[] {
    return [createEditorCommandEntry()];
  }
}

export function createEditorCommandModule(temporaryDirectoryPrefix?: string): ICommandModule {
  return {
    name: 'agent-command-editor',
    commandSources: [new EditorCommandSource()],
    systemCommands: [createEditorSystemCommand(temporaryDirectoryPrefix)],
  };
}
