/**
 * #3189: the commands that belong to the terminal the user sits at — the ones the default assembly
 * marks `runner: 'client'`. A terminal attached to a workspace daemon runs these in its own process,
 * on its own terminal and working directory, and sends nothing to the daemon.
 *
 * Each one is the in-process command's own execute function, so an attached terminal answers exactly
 * as a standalone one does; only where it runs changes.
 */
import { selectCommandModules } from '@robota-sdk/agent-framework';

import { createEditorCommandModule } from '../editor/editor-command-module.js';
import { executeEditorCommand } from '../editor/editor-command.js';
import {
  createKeybindingsCommandModule,
  executeKeybindingsCommand,
} from '../keybindings/keybindings-command-module.js';
import { createShellCommandModule } from '../shell/shell-command-module.js';
import { executeShellCommand } from '../shell/shell-command.js';
import { createThemeCommandModule, executeThemeCommand } from '../theme/theme-command-module.js';

import type { IKeybindingsFilePort } from '../keybindings/keybindings-command-module.js';
import type {
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
  ICommandModule,
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
  /**
   * The same module selection the default assembly is given (`agent-command-shell`, …): a module it
   * leaves out is left out here too, so an attached terminal offers no command a standalone one
   * would not. Absent → every client-run module.
   */
  readonly enabledCommandModules?: readonly string[];
  /** Applied after `enabledCommandModules`, as in the default assembly (deny > allow). */
  readonly disabledCommandModules?: readonly string[];
}

type TClientExecute = ITerminalClientCommand['execute'];

/**
 * Every client-run command the module selection keeps, whether or not its port is given. The set
 * shrinks only with the selection, never with a missing port: the attached terminal routes by it, so
 * a selected command left out would run on the daemon instead — and without its port the command
 * still answers as its in-process twin does.
 */
export function createTerminalClientCommands(
  options: ITerminalClientCommandOptions,
): readonly ITerminalClientCommand[] {
  const {
    shellExecutable,
    editorTemporaryDirectoryPrefix,
    keybindingsFile,
    themeCatalogue,
    enabledCommandModules,
    disabledCommandModules,
  } = options;
  // Each client command is paired with its in-process module, so selection matches by the module's
  // own name and the command keeps that module's command name.
  const candidates: ReadonlyArray<readonly [ICommandModule, TClientExecute]> = [
    [
      createShellCommandModule(shellExecutable),
      (host, args) => executeShellCommand(host, args, shellExecutable),
    ],
    [
      createEditorCommandModule(editorTemporaryDirectoryPrefix),
      (host, args) => executeEditorCommand(host, args, editorTemporaryDirectoryPrefix),
    ],
    [
      createKeybindingsCommandModule(keybindingsFile),
      (host) => executeKeybindingsCommand(keybindingsFile, host),
    ],
    [
      createThemeCommandModule(themeCatalogue),
      (_host, args) => executeThemeCommand(themeCatalogue, args),
    ],
  ];
  const selected = new Set(
    selectCommandModules(
      candidates.map(([module]) => module),
      enabledCommandModules,
      disabledCommandModules,
    ),
  );
  return candidates
    .filter(([module]) => selected.has(module))
    .flatMap(([module, execute]) =>
      (module.systemCommands ?? []).map((command) => ({ name: command.name, execute })),
    );
}
