/**
 * #3189: the commands that belong to the terminal the user sits at (`/shell`, `/editor`, `/theme`,
 * `/keybindings`). A terminal attached to a workspace daemon runs these in its own process — on its
 * own terminal, in its own working directory — and sends nothing to the daemon.
 *
 * The attached terminal routes by the set it is given here, never by the daemon's catalog, so an
 * older daemon or a catalog that arrives late cannot send one of these commands to the daemon.
 *
 * The in-process session applies a command's host actions and emits its UI intents; here the
 * terminal does both itself. The one host action these commands produce, the appearance settings
 * patch, is written through the writer the composition root gives. Anything else is refused by name
 * rather than skipped, because a command that asked for an action nobody performed would otherwise
 * report success.
 */
import { SessionTerminalHandoffGate, isAppearanceSettingsPatch } from '@robota-sdk/agent-framework';

import type {
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';
import type {
  ICommandResult,
  TAppearanceSettingsPatch,
  TCommandUiIntent,
} from '@robota-sdk/agent-interface-command';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

/** What a client-run command may use: this terminal's handoff and working directory. */
export type TTuiClientCommandHost = ICommandHostTerminalHandoff & ICommandHostWorkspace;

/**
 * A command this terminal runs itself. Declared here rather than imported: the command package's
 * `createTerminalClientCommands` produces objects of this shape, and this package does not depend on
 * the command package.
 */
export interface ITuiClientCommand {
  readonly name: string;
  execute(host: TTuiClientCommandHost, args: string): ICommandResult | Promise<ICommandResult>;
}

/** The client-run commands, and how this terminal writes what they change. */
export interface ITuiClientCommands {
  readonly commands: readonly ITuiClientCommand[];
  /** Writes the appearance keys of the user's settings; resolves when written. */
  writeAppearanceSettings(patch: TAppearanceSettingsPatch): void | Promise<void>;
}

/** A client command's answer: the result to show, and the screens it asked this terminal to open. */
export interface ITuiClientCommandOutcome {
  /** Host actions and UI intents are consumed: this carries only message, success and data. */
  readonly result: ICommandResult;
  /** Empty unless the command succeeded and every host action was applied. */
  readonly uiIntents: readonly TCommandUiIntent[];
}

const APPEARANCE_PATCH = 'appearance-settings-patch';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refused(message: string): ITuiClientCommandOutcome {
  return { result: { success: false, message }, uiIntents: [] };
}

/** The client command named `name`, or undefined when there is none or no set was given. */
export function findTuiClientCommand(
  commands: ITuiClientCommands | undefined,
  name: string,
): ITuiClientCommand | undefined {
  return commands?.commands.find((command) => command.name === name);
}

/**
 * Runs a client command and applies what it asks for on this terminal.
 *
 * A failed result passes through unchanged: its actions were never requested to run. Every host
 * action is checked before any is written, so a result that carries an invalid patch or an action
 * this terminal cannot perform writes nothing and becomes an explicit failure. A command that throws
 * rejects, as it does in the in-process session.
 */
export async function runTuiClientCommand(
  command: ITuiClientCommand,
  args: string,
  host: TTuiClientCommandHost,
  writers: Pick<ITuiClientCommands, 'writeAppearanceSettings'>,
): Promise<ITuiClientCommandOutcome> {
  const result = await command.execute(host, args);
  if (!result.success) return { result, uiIntents: [] };

  const patches: TAppearanceSettingsPatch[] = [];
  for (const action of result.hostActions ?? []) {
    if (action.type !== APPEARANCE_PATCH) {
      return refused(`Cannot apply '${action.type}' on this terminal.`);
    }
    if (!isAppearanceSettingsPatch(action.patch)) {
      return refused(`Failed to apply '${APPEARANCE_PATCH}': invalid appearance settings patch`);
    }
    patches.push(action.patch);
  }

  for (const patch of patches) {
    try {
      await writers.writeAppearanceSettings(patch);
    } catch (error) {
      return refused(`Failed to apply '${APPEARANCE_PATCH}': ${errorMessage(error)}`);
    }
  }

  return {
    result: {
      message: result.message,
      success: result.success,
      ...(result.data !== undefined ? { data: result.data } : {}),
    },
    uiIntents: result.uiIntents ?? [],
  };
}

/**
 * The host a client command runs against: this terminal's own handoff, behind the same gate the
 * in-process session puts in front of it (one handoff at a time, and a refusal instead of a hang
 * when there is no interactive terminal). Build it once per attached terminal, so that exclusivity
 * spans every command it runs.
 *
 * Without a handoff, `canHandoffTerminal()` is false and `/shell` and `/editor` take their refusal
 * path. Commands run here were typed by the user at this terminal, so the invocation source is
 * always `'user'`.
 */
export function createTuiClientCommandHost(options: {
  readonly terminalHandoff: ITerminalHandoff | undefined;
  readonly cwd: string;
}): TTuiClientCommandHost {
  const gate = new SessionTerminalHandoffGate(options.terminalHandoff);
  const { cwd } = options;
  return {
    canHandoffTerminal: () => gate.canHandoffTerminal(),
    runWithTerminal: (fn) => gate.runWithTerminal(fn),
    getCwd: () => cwd,
    getCommandInvocationSource: () => 'user',
  };
}
