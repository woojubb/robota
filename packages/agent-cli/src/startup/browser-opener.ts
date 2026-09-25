/**
 * Opening an authorization page in the user's browser: an argv call to the platform's opener,
 * never a shell line, and only for an `https:` URL — the URL is built from a server's metadata, so
 * nothing in it may be read as a command or option.
 *
 * On Windows `rundll32 url.dll,FileProtocolHandler` is used rather than `cmd /c start`: `cmd`
 * re-parses its whole command line, so an `&` in the URL's query would start a second command.
 */

import { execFile } from 'node:child_process';

export interface IBrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
}

const OPEN_TIMEOUT_MS = 15_000;

/** The opener for `platform`; throws for anything but an `https:` URL. */
export function browserCommand(
  url: URL,
  platform: NodeJS.Platform = process.platform,
): IBrowserCommand {
  if (url.protocol !== 'https:') throw new Error('Only an https URL is opened in the browser.');
  const href = url.href;
  if (platform === 'darwin') return { command: 'open', args: [href] };
  if (platform === 'win32') {
    return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', href] };
  }
  return { command: 'xdg-open', args: [href] };
}

export type TExecFile = (
  command: string,
  args: readonly string[],
  callback: (error: Error | null) => void,
) => void;

const defaultExecFile: TExecFile = (command, args, callback) => {
  execFile(command, [...args], { timeout: OPEN_TIMEOUT_MS, windowsHide: true }, (error) =>
    callback(error),
  );
};

/** Open `url`; resolves once the opener has handed it to the browser. */
export function openInBrowser(
  url: URL,
  deps: { readonly platform?: NodeJS.Platform; readonly execFile?: TExecFile } = {},
): Promise<void> {
  const { command, args } = browserCommand(url, deps.platform);
  return new Promise((resolve, reject) => {
    (deps.execFile ?? defaultExecFile)(command, args, (error) => {
      if (error === null) resolve();
      else reject(new Error('The browser could not be opened.'));
    });
  });
}
