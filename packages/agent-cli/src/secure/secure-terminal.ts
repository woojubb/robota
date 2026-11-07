/**
 * Where a passphrase or recovery key is typed: a terminal, and nothing else.
 *
 * On macOS and Linux that is `openSecretTerminal` — the controlling terminal opened as streams of its
 * own, raw and silent, with no fallback to a pipe or a file. That path does not exist on Windows (no
 * `/dev/tty`), so there the same conversation runs on the console through `promptHiddenLine` with
 * `requireTty`: the prompt refuses a piped or redirected stdin instead of reading the first line of
 * it, and reads the line with the controlling-terminal path's own reader, so the same keystrokes
 * give the same passphrase on every platform. Both give the command one `ISecretTerminalSession`,
 * so the command has a single code path and no way to ask where a secret came from.
 */
import { SecretInputCancelled, openSecretTerminal } from '../devices/secret-terminal.js';
import {
  HiddenPromptCancelledError,
  promptHiddenLine,
  type IHiddenPromptStreams,
} from '../startup/hidden-prompt.js';

import type { ISecretTerminal, ISecretTerminalSession } from '../devices/secret-terminal.js';

const CLEAR_SCREEN_AND_SCROLLBACK = '\x1b[2J\x1b[3J\x1b[H';

/** The console's two ends; the output reports whether it is a terminal. */
export interface IConsoleStreams {
  readonly input: IHiddenPromptStreams['input'];
  readonly output: NodeJS.WritableStream & { readonly isTTY?: boolean };
}

export interface IOpenSecureTerminalOptions {
  readonly platform?: NodeJS.Platform;
  /** The console the Windows path prompts on; defaults to this process's stdin and stderr. */
  readonly console?: IConsoleStreams;
}

function consoleIsInteractive(streams: IConsoleStreams): boolean {
  return (
    streams.input.isTTY === true &&
    typeof streams.input.setRawMode === 'function' &&
    streams.output.isTTY === true
  );
}

/**
 * The console variant of a secret terminal. It cannot switch to an alternate screen the way the
 * controlling-terminal path does, so what it shows stays in the console's scrollback until the
 * screen is cleared (best effort: Windows consoles that do not interpret the control sequence print
 * them instead). Everything typed is read hidden, whatever `echo` asks for.
 */
function openConsoleTerminal(streams: IConsoleStreams): ISecretTerminalSession | undefined {
  if (!consoleIsInteractive(streams)) return undefined;
  return {
    async run<T>(work: (terminal: ISecretTerminal) => Promise<T>): Promise<T> {
      const terminal: ISecretTerminal = {
        write: (text) => {
          streams.output.write(text);
        },
        clearScreen: () => {
          streams.output.write(CLEAR_SCREEN_AND_SCROLLBACK);
        },
        readLine: async (prompt, options) => {
          try {
            return await promptHiddenLine(prompt, streams, {
              requireTty: true,
              ...(options?.signal === undefined ? {} : { signal: options.signal }),
            });
          } catch (error) {
            throw error instanceof HiddenPromptCancelledError ? new SecretInputCancelled() : error;
          }
        },
      };
      return work(terminal);
    },
  };
}

/** The terminal a secret may be typed on, or `undefined` when this process has none to offer. */
export function openSecureTerminal(
  options: IOpenSecureTerminalOptions = {},
): ISecretTerminalSession | undefined {
  if ((options.platform ?? process.platform) !== 'win32') return openSecretTerminal();
  return openConsoleTerminal(options.console ?? { input: process.stdin, output: process.stderr });
}
