/**
 * Opening an authorization page in the user's browser: an argv call to the platform's opener,
 * never a shell line, and only for an `https:` URL — the URL is built from a server's metadata, so
 * nothing in it may be read as a command or option.
 *
 * On Windows `rundll32 url.dll,FileProtocolHandler` is used rather than `cmd /c start`: `cmd`
 * re-parses its whole command line, so an `&` in the URL's query would start a second command.
 *
 * The opener is started and let go: it hands the link to the browser and may then stay in the
 * foreground (`xdg-open` without a detected desktop environment does), and the browser it started can
 * belong to its group. So the call settles once the opener has started; it is never waited for,
 * tracked or ended, in either mode.
 */

import { spawn } from 'node:child_process';

import { withChildSession } from '@robota-sdk/agent-core/node';

export interface IBrowserCommand {
  readonly command: string;
  readonly args: readonly string[];
}

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

/** Start `command` and let it go; `started` is told once, whether it started or could not. */
export type TStartOpener = (
  command: string,
  args: readonly string[],
  started: (error: Error | null) => void,
) => void;

// Found on PATH, so in its own session in secure mode; detached and unreferenced in both modes.
const startDetached: TStartOpener = (command, args, started) => {
  let told = false;
  const tell = (error: Error | null): void => {
    if (told) return;
    told = true;
    started(error);
  };
  try {
    const child = spawn(
      command,
      [...args],
      withChildSession({ stdio: 'ignore', detached: true, windowsHide: true }),
    );
    child.once('spawn', () => {
      child.unref();
      tell(null);
    });
    child.once('error', (error) => tell(error));
  } catch (error) {
    tell(error instanceof Error ? error : new Error(String(error)));
  }
};

/** Open `url`; resolves once the platform's opener has started. */
export function openInBrowser(
  url: URL,
  deps: { readonly platform?: NodeJS.Platform; readonly start?: TStartOpener } = {},
): Promise<void> {
  const { command, args } = browserCommand(url, deps.platform);
  return new Promise((resolve, reject) => {
    (deps.start ?? startDetached)(command, args, (error) => {
      if (error === null) resolve();
      else reject(new Error('The browser could not be opened.'));
    });
  });
}
