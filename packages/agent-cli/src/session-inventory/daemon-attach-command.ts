/**
 * `robota --attach`: the full terminal UI on this workspace's daemon, instead of a session of its own.
 *
 * The daemon's session is the daemon's: its model, permissions and conversation come from how it
 * started, so this terminal takes presentation flags only. Attaching is the same trust action as
 * `robota session attach` — an interactive terminal and the user's yes on it — and detaching leaves
 * the daemon running.
 */

import { realpathSync } from 'node:fs';

import { confirmAttachOnTerminal, type IAttachConfirmation } from './attach-confirmation.js';
import { findWorkspaceDaemon } from './daemon-command.js';
import { runConfirmedAttach, type IOpenAttach } from './session-attach-command.js';
import { resolveSupervisedDirectory } from './supervised-session-control.js';

import type { openSupervisedAttach } from './supervised-attach-client.js';
import type { listSupervisedSessions } from './supervised-session-control.js';

export const DAEMON_ATTACH_FLAG = '--attach';

/**
 * Written for whoever reads `--help`, a model included: what it does, when to use it, what it
 * returns, and that only the user can run it.
 */
export const DAEMON_ATTACH_HELP =
  'Usage: robota --attach [--screen-reader|--no-screen-reader]\n' +
  '\n' +
  "Open the full terminal UI on this workspace's running daemon (robota daemon start) instead of\n" +
  'starting a session of its own: the same conversation, prompts and questions its other clients\n' +
  "see, and its sessions to list, start and switch. The daemon's session is shaped by the daemon, so\n" +
  'no option that shapes a session is taken; to change one, restart the daemon.\n' +
  '\n' +
  'It asks for confirmation on this terminal first and needs an interactive terminal, so only the user\n' +
  'can run it; a script or an agent should suggest the command instead, or connect to the URL that\n' +
  '`robota daemon start --json` prints. Detach with /exit or Ctrl-C: the daemon keeps running. Exits 0\n' +
  'after detaching, 1 when it could not attach.\n';

export interface IDaemonAttachRenderOptions extends IOpenAttach {
  readonly sessionLabel: string;
  /** `--screen-reader` / `--no-screen-reader`; `undefined` when neither was given. */
  readonly screenReaderFlag: boolean | undefined;
}

/** Renders the attached terminal UI until it ends; resolves how it ended. */
export type TDaemonAttachRender = (options: IDaemonAttachRenderOptions) => Promise<'user' | 'closed'>;

export interface IDaemonAttachCommandOptions {
  /** The directory the command runs in; its real path names the workspace. */
  readonly cwd: string;
  readonly isTTY?: boolean;
  readonly root?: string;
  readonly list?: typeof listSupervisedSessions;
  /** Supplied by the interactive CLI; absent in a runtime without a terminal UI. */
  readonly render?: TDaemonAttachRender;
  readonly confirm?: (question: IAttachConfirmation) => Promise<boolean>;
  readonly open?: typeof openSupervisedAttach;
}

/** `robota --attach …`: the flag given to robota itself, not to a subcommand. */
export function isDaemonAttachInvocation(args: readonly string[]): boolean {
  return args.includes(DAEMON_ATTACH_FLAG) && args[0]?.startsWith('-') === true;
}

type TParsed =
  | { readonly kind: 'help' }
  | { readonly kind: 'usage' }
  | { readonly kind: 'refused'; readonly argument: string }
  | { readonly kind: 'attach'; readonly screenReader: boolean | undefined };

function parseAttachArgs(args: readonly string[]): TParsed {
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' };
  let attach = 0;
  let screenReader: boolean | undefined;
  for (const argument of args) {
    if (argument === DAEMON_ATTACH_FLAG) {
      attach += 1;
    } else if (argument === '--screen-reader' || argument === '--no-screen-reader') {
      if (screenReader !== undefined) return { kind: 'usage' };
      screenReader = argument === '--screen-reader';
    } else {
      return { kind: 'refused', argument };
    }
  }
  return attach === 1 ? { kind: 'attach', screenReader } : { kind: 'usage' };
}

export async function runDaemonAttachCommand(
  args: readonly string[],
  options: IDaemonAttachCommandOptions,
): Promise<number> {
  const parsed = parseAttachArgs(args);
  if (parsed.kind === 'help') {
    process.stdout.write(DAEMON_ATTACH_HELP);
    return 0;
  }
  if (parsed.kind === 'usage') {
    process.stderr.write(DAEMON_ATTACH_HELP);
    return 1;
  }
  if (parsed.kind === 'refused') {
    process.stderr.write(
      `robota --attach does not take ${parsed.argument}: the daemon's session is shaped by the ` +
        'daemon, not by the terminal attaching to it. To run it differently, stop it with ' +
        'robota daemon stop, change its settings, and start it again with robota daemon start.\n',
    );
    return 1;
  }
  const render = options.render;
  if (render === undefined) {
    process.stderr.write('robota --attach needs the interactive CLI; this runtime has no terminal UI.\n');
    return 1;
  }
  const root = options.root ?? resolveSupervisedDirectory();
  let workspace: string;
  let daemon: Awaited<ReturnType<typeof findWorkspaceDaemon>>;
  try {
    workspace = realpathSync(options.cwd);
    daemon = await findWorkspaceDaemon(workspace, {
      root,
      ...(options.list !== undefined ? { list: options.list } : {}),
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to find the daemon.'}\n`);
    return 1;
  }
  // Before the terminal check: a script learns the step it can take itself.
  if (daemon === undefined) {
    process.stderr.write(`No daemon is running in ${workspace}. Start one with: robota daemon start\n`);
    return 1;
  }
  if (!(options.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) {
    process.stderr.write(
      "Attaching needs an interactive terminal and the user's confirmation. " +
        `Ask the user to run: robota ${DAEMON_ATTACH_FLAG}\n`,
    );
    return 1;
  }
  const { id, name, generation } = daemon;
  const question: IAttachConfirmation = { id, ...(name !== undefined ? { name } : {}), mode: 'drive' };
  if (!(await (options.confirm ?? confirmAttachOnTerminal)(question))) {
    process.stderr.write('Attach cancelled.\n');
    return 1;
  }
  // Bound to the process start the user confirmed: a daemon restarted since is a different one.
  return runConfirmedAttach({
    id,
    mode: 'drive',
    generation,
    root,
    render: (open) =>
      render({ ...open, sessionLabel: name ?? id, screenReaderFlag: parsed.screenReader }),
    messages: {
      detached: `Detached from daemon ${id}. It keeps running; stop it with robota daemon stop.`,
      closed: 'The daemon closed the connection (it stopped, or cut this terminal off).',
    },
    ...(options.open !== undefined ? { open: options.open } : {}),
  });
}
