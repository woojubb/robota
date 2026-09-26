/**
 * `robota session attach <id> [--observe]`: put this terminal on a live supervised session.
 *
 * Attaching is a trust action: the terminal gets the session's conversation and, in drive mode, sends
 * prompts and answers its permission questions. So it runs only for a person at an interactive
 * terminal who confirms it there. A caller without a terminal — a script, or a model running shell
 * commands — is refused with the command a person should run instead.
 */

import { resolveScreenReaderRenderFields } from '../startup/screen-reader-enablement.js';
import { readUserSettingsOrExit } from '../startup/user-settings.js';
import { confirmAttachOnTerminal, type IAttachConfirmation } from './attach-confirmation.js';
import { openSupervisedAttach, type ISupervisedAttachConnection } from './supervised-attach-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory } from './supervised-session-control.js';

import type { TSettingsData } from '@robota-sdk/agent-framework';
import type { TScreenReaderChannel } from '@robota-sdk/agent-ui-terminal';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Written for whoever reads `--help`, a model included: what it does, when to use it, what it
 * returns, and that only the user can run it.
 */
export const SESSION_ATTACH_HELP =
  'Usage: robota session attach <supervised-id> [--observe] [--screen-reader|--no-screen-reader]\n' +
  '\n' +
  'Attach this terminal to a live supervised session started with `robota session start --background`.\n' +
  'Drive mode (the default) sends prompts and answers the session\'s questions alongside its other\n' +
  'surfaces; --observe follows the conversation read-only. Use it to check on or steer a background\n' +
  'session; find ids with `robota session list` or `robota session view`.\n' +
  '\n' +
  'It asks for confirmation on this terminal first and needs an interactive terminal, so only the user\n' +
  'can run it; a script or an agent should suggest the command instead. Detach with /exit, Ctrl-C or\n' +
  'Ctrl-]: the session keeps running. Exits 0 after detaching, 1 when it could not attach.\n';

export interface IAttachedViewRenderOptions {
  readonly connection: Omit<ISupervisedAttachConnection, 'detach' | 'driverId'>;
  readonly mode: 'drive' | 'observe';
  readonly sessionLabel: string;
  readonly driverId: string;
  readonly screenReader?: boolean;
  readonly screenReaderChannel?: TScreenReaderChannel;
  readonly screenReaderHint?: boolean;
}

export type TAttachedViewRender = (options: IAttachedViewRenderOptions) => Promise<'user' | 'closed'>;

export interface IConfirmedAttach {
  readonly id: string;
  readonly mode: 'drive' | 'observe';
  /** The process start the user confirmed; a restart since then is refused. */
  readonly generation: string;
  readonly sessionLabel: string;
  readonly root: string;
  readonly render: TAttachedViewRender;
  readonly screenReader?: Pick<IAttachedViewRenderOptions, 'screenReader' | 'screenReaderChannel' | 'screenReaderHint'>;
}

/** Attach after the user said yes, run the view until it ends, and always detach. */
export async function runConfirmedAttach(attach: IConfirmedAttach): Promise<number> {
  let connection: ISupervisedAttachConnection;
  try {
    connection = await openSupervisedAttach(attach.id, attach.mode, attach.root, attach.generation);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to attach.'}\n`);
    return 1;
  }
  let ended: 'user' | 'closed';
  try {
    ended = await attach.render({
      connection: { send: connection.send, subscribe: connection.subscribe, onClose: connection.onClose },
      mode: attach.mode,
      sessionLabel: attach.sessionLabel,
      driverId: connection.driverId,
      ...attach.screenReader,
    });
  } finally {
    connection.detach();
  }
  const { id } = attach;
  process.stdout.write(
    ended === 'closed'
      ? `Supervised session ${id} closed the connection (it stopped, or cut this terminal off).\n`
      : `Detached from ${id}. It keeps running; stop it with robota session stop ${id} or from robota session view.\n`,
  );
  return 0;
}

export interface ISessionAttachCommandOptions {
  readonly isTTY?: boolean;
  readonly root?: string;
  /** Supplied by the interactive CLI; resolves how the view ended. */
  readonly render?: TAttachedViewRender;
  readonly confirm?: (question: IAttachConfirmation) => Promise<boolean>;
  readonly settings?: TSettingsData;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export async function runSessionAttachCommand(
  argv: readonly string[],
  options: ISessionAttachCommandOptions = {},
): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(SESSION_ATTACH_HELP);
    return 0;
  }
  const [id, ...flags] = argv;
  const observe = flags.includes('--observe');
  const screenReaderFlags = flags.filter((flag) => flag === '--screen-reader' || flag === '--no-screen-reader');
  if (
    id === undefined || !ID_PATTERN.test(id) || new Set(flags).size !== flags.length ||
    screenReaderFlags.length > 1 ||
    flags.some((flag) => flag !== '--observe' && flag !== '--screen-reader' && flag !== '--no-screen-reader')
  ) {
    process.stderr.write(SESSION_ATTACH_HELP);
    return 1;
  }
  const mode = observe ? 'observe' : 'drive';
  const command = `robota session attach ${id}${observe ? ' --observe' : ''}`;
  if (!(options.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) {
    process.stderr.write(
      'Attaching needs an interactive terminal and the user\'s confirmation. ' +
        `Ask the user to run: ${command}\n`,
    );
    return 1;
  }
  if (!options.render) {
    process.stderr.write('robota session attach needs the interactive CLI; this runtime has no terminal UI.\n');
    return 1;
  }
  const screenReader = resolveScreenReaderRenderFields(
    options.settings ?? readUserSettingsOrExit(),
    screenReaderFlags.length === 0 ? undefined : screenReaderFlags[0] === '--screen-reader',
    options.env ?? process.env,
  );
  const root = options.root ?? resolveSupervisedDirectory();
  let row;
  try {
    row = (await listSupervisedSessions(root, undefined, { includeName: true, includeGeneration: true }))
      .find((candidate) => candidate.id === id);
  } catch {
    row = undefined;
  }
  if (row?.liveness !== 'alive' || row.control !== 'available' || row.generation === undefined) {
    process.stderr.write(`${id} is not a live supervised session this terminal can attach to.\n`);
    return 1;
  }
  const question: IAttachConfirmation = { id, ...(row.name !== undefined ? { name: row.name } : {}), mode };
  if (!(await (options.confirm ?? confirmAttachOnTerminal)(question))) {
    process.stderr.write('Attach cancelled.\n');
    return 1;
  }
  // Bound to the generation the user confirmed: a restart in the meantime is a different session.
  return runConfirmedAttach({
    id, mode, generation: row.generation, sessionLabel: row.name ?? id, root, render: options.render,
    screenReader: {
      screenReader: screenReader.screenReader,
      ...(screenReader.screenReaderChannel !== undefined ? { screenReaderChannel: screenReader.screenReaderChannel } : {}),
      ...(screenReader.screenReaderHint !== undefined ? { screenReaderHint: screenReader.screenReaderHint } : {}),
    },
  });
}
