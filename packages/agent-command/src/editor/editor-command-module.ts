/**
 * TERM-004: `/editor` command module — a framework-level consumer of the terminal-handoff capability.
 */
import { EDITOR_COMMAND_DESCRIPTION, executeEditorCommand } from './editor-command.js';

import type { ICommandModule, ISystemCommand } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandSource } from '@robota-sdk/agent-interface-transport';

export function createEditorCommandEntry(): ICommand {
  return {
    name: 'editor',
    displayName: 'Editor',
    description: EDITOR_COMMAND_DESCRIPTION,
    source: 'editor',
    modelInvocable: false,
  };
}

function createEditorSystemCommand(): ISystemCommand {
  const entry = createEditorCommandEntry();
  return {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: executeEditorCommand,
  };
}

export class EditorCommandSource implements ICommandSource {
  readonly name = 'editor';

  getCommands(): ICommand[] {
    return [createEditorCommandEntry()];
  }
}

export function createEditorCommandModule(): ICommandModule {
  return {
    name: 'agent-command-editor',
    commandSources: [new EditorCommandSource()],
    systemCommands: [createEditorSystemCommand()],
  };
}
