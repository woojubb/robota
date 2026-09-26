/**
 * #3189: the commands that belong to the terminal the user sits at — the ones the default assembly
 * marks `runner: 'client'`. A terminal attached to a workspace daemon runs these in its own process,
 * on its own terminal and working directory, and sends nothing to the daemon.
 *
 * Each one is the in-process command's own execute function, so an attached terminal answers exactly
 * as a standalone one does; only where it runs changes.
 */
import { createEditorCommandEntry } from '../editor/editor-command-module.js';
import { executeEditorCommand } from '../editor/editor-command.js';
import {
  createKeybindingsCommandEntry,
  executeKeybindingsCommand,
} from '../keybindings/keybindings-command-module.js';
import { createShellCommandEntry } from '../shell/shell-command-module.js';
import { executeShellCommand } from '../shell/shell-command.js';
import { createThemeCommandEntry, executeThemeCommand } from '../theme/theme-command-module.js';

import type { IKeybindingsFilePort } from '../keybindings/keybindings-command-module.js';
import type {
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';
import type { ICommandResult, IThemeCataloguePort } from '@robota-sdk/agent-interface-command';

/** A command the terminal runs itself, with the terminal's own handoff and working directory. */
export interface ITerminalClientCommand {
  readonly name: string;
  execute(
    host: ICommandHostTerminalHandoff & ICommandHostWorkspace,
    args: string,
  ): ICommandResult | Promise<ICommandResult>;
}

/** The terminal's own capabilities — the same ones its in-process command modules are given. */
export interface ITerminalClientCommandOptions {
  /** The shell `/shell` runs; absent → the platform shell, as for the in-process command. */
  readonly shellExecutable?: string;
  /** Product-owned prefix for `/editor`'s temporary directory; absent → the command's default. */
  readonly editorTemporaryDirectoryPrefix?: string;
  /** Absent → `/keybindings` answers where key bindings live, as the in-process command does. */
  readonly keybindingsFile?: IKeybindingsFilePort;
  /** Absent → `/theme` answers where themes live, as the in-process command does. */
  readonly themeCatalogue?: IThemeCataloguePort;
}

/**
 * Every client-run command, whether or not its port is given. The set never shrinks with a missing
 * port: the attached terminal routes by it, so a command left out would run on the daemon instead —
 * and without its port the command still answers as its in-process twin does.
 */
export function createTerminalClientCommands(
  options: ITerminalClientCommandOptions,
): readonly ITerminalClientCommand[] {
  const { shellExecutable, editorTemporaryDirectoryPrefix, keybindingsFile, themeCatalogue } =
    options;
  return [
    {
      name: createShellCommandEntry().name,
      execute: (host, args) => executeShellCommand(host, args, shellExecutable),
    },
    {
      name: createEditorCommandEntry().name,
      execute: (host, args) => executeEditorCommand(host, args, editorTemporaryDirectoryPrefix),
    },
    {
      name: createKeybindingsCommandEntry().name,
      execute: (host) => executeKeybindingsCommand(keybindingsFile, host),
    },
    {
      name: createThemeCommandEntry().name,
      execute: (_host, args) => executeThemeCommand(themeCatalogue, args),
    },
  ];
}
