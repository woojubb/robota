import { resolveEditor } from '../editor/resolve-editor.js';
import { spawnInherited } from '../shell/spawn-inherited.js';

import type {
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';

export interface IKeybindingsFilePort {
  ensureFile(): Promise<string>;
}

export function createKeybindingsCommandEntry(): ICommand {
  return {
    name: 'keybindings',
    displayName: 'Keybindings',
    description: 'Open the contextual terminal keybindings file in $EDITOR',
    source: 'keybindings',
    // User-only: UI preference.
    modelInvocable: false,
  };
}

// A host without a terminal (the desktop app's sidecar) still answers, so the command is never
// "unknown" there — it says where key bindings live instead.
const KEYBINDINGS_UNAVAILABLE =
  'Key bindings belong to the robota terminal, and this surface has none. Run /keybindings in the robota terminal.';

async function executeKeybindingsCommand(
  file: IKeybindingsFilePort | undefined,
  context: ICommandHostTerminalHandoff & ICommandHostWorkspace,
): Promise<ICommandResult> {
  if (!file) return { success: false, message: KEYBINDINGS_UNAVAILABLE };
  if (!context.canHandoffTerminal()) {
    return { success: false, message: 'Keybindings editor is unavailable here.' };
  }
  const path = await file.ensureFile();
  const editor = resolveEditor();
  const exitCode = await context.runWithTerminal(() =>
    spawnInherited(editor.command, [...editor.args, path], context.getCwd()),
  );
  if (exitCode !== 0) {
    return {
      success: false,
      message: `Keybindings editor exited with code ${exitCode}.`,
      data: { path, exitCode },
    };
  }
  return { success: true, message: `Opened keybindings: ${path}`, data: { path } };
}

export class KeybindingsCommandSource implements ICommandSource {
  readonly name = 'keybindings';

  getCommands(): ICommand[] {
    return [createKeybindingsCommandEntry()];
  }
}

export function createKeybindingsCommandModule(
  file: IKeybindingsFilePort | undefined,
): ICommandModule {
  const entry = createKeybindingsCommandEntry();
  const command: ISystemCommand = {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: (context) => executeKeybindingsCommand(file, context),
  };
  return {
    name: 'agent-command-keybindings',
    commandSources: [new KeybindingsCommandSource()],
    systemCommands: [command],
  };
}
