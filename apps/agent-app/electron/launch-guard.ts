/**
 * Chromium's remote debugging gives whoever starts the app the DevTools protocol: JavaScript in the renderer and, through
 * the preload bridge, the main process that holds the remote credentials. No Electron fuse turns it off, and the
 * command line is the only way to turn it on, so a packaged launch that asks for it is refused before anything starts.
 */

/** The Chromium switches that open a DevTools protocol endpoint on the browser process. */
const REMOTE_DEBUGGING_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const;

/** The exit code of a refused launch, so a launcher can tell the refusal from a crash. */
export const REMOTE_DEBUGGING_REFUSED_EXIT_CODE = 78;

export interface IRemoteDebuggingLaunch {
  /** electron `app.isPackaged`; a development launch (Playwright included) keeps remote debugging. */
  readonly isPackaged: boolean;
  /** The main process's `process.argv`. */
  readonly argv: readonly string[];
  /** electron `app.commandLine.hasSwitch`: Chromium's own reading of the command line. */
  readonly hasSwitch: (name: string) => boolean;
}

/**
 * The switch name an argument spells, as Chromium reads it: a `--`, `-` or (Windows) `/` prefix, an optional `=value`,
 * and case-insensitive on Windows. Reading every spelling on every platform only refuses more.
 */
function switchName(argument: string): string | undefined {
  return /^(?:--?|\/)([^=]+)/u.exec(argument)?.[1]?.toLowerCase();
}

/** The remote debugging switch a packaged launch carries, or `undefined` when the launch may go on. */
export function refusedRemoteDebuggingSwitch(launch: IRemoteDebuggingLaunch): string | undefined {
  if (!launch.isPackaged) return undefined;
  const spelled = new Set(launch.argv.map(switchName));
  return REMOTE_DEBUGGING_SWITCHES.find((name) => launch.hasSwitch(name) || spelled.has(name));
}
