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

/**
 * Opens `path` in the user's editor on the terminal the command holds, and resolves with the editor's
 * exit code. Starting a process is the host's, so a Node host passes `openFileInEditor` from
 * `@robota-sdk/agent-product/command/node`; without one the command says it cannot open an editor here.
 */
export type TOpenFileInEditor = (path: string, cwd: string) => Promise<number>;

export function createKeybindingsCommandEntry(): ICommand {
  return {
    name: 'keybindings',
    displayName: 'Keybindings',
    description: 'Open the contextual terminal keybindings file in $EDITOR',
    source: 'keybindings',
    // User-only: UI preference.
    modelInvocable: false,
    // Key bindings belong to the terminal the user sits at, so that terminal runs it, even when
    // attached.
    runner: 'client',
    surfaces: ['terminal'],
  };
}

// A host without a terminal (the desktop app's sidecar) still answers, so the command is never
// "unknown" there — it says where key bindings live instead.
const KEYBINDINGS_UNAVAILABLE =
  'Key bindings are available in an interactive terminal. Run /keybindings there.';

export async function executeKeybindingsCommand(
  file: IKeybindingsFilePort | undefined,
  context: ICommandHostTerminalHandoff & ICommandHostWorkspace,
  openInEditor: TOpenFileInEditor | undefined,
): Promise<ICommandResult> {
  if (!file) return { success: false, message: KEYBINDINGS_UNAVAILABLE };
  if (!context.canHandoffTerminal() || openInEditor === undefined) {
    return { success: false, message: 'Keybindings editor is unavailable here.' };
  }
  const path = await file.ensureFile();
  const exitCode = await context.runWithTerminal(() => openInEditor(path, context.getCwd()));
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
  openInEditor?: TOpenFileInEditor,
): ICommandModule {
  const entry = createKeybindingsCommandEntry();
  const command: ISystemCommand = {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    runner: entry.runner,
    surfaces: entry.surfaces,
    lifecycle: 'inline',
    execute: (context) => executeKeybindingsCommand(file, context, openInEditor),
  };
  return {
    name: 'agent-command-keybindings',
    commandSources: [new KeybindingsCommandSource()],
    systemCommands: [command],
  };
}
