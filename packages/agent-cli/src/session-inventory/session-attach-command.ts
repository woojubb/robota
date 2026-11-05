import type { ICliRuntimeContext } from '../product/runtime-context.js';
/**
 * `the CLI session attach <id> [--observe]`: put this terminal on a live supervised session.
 *
 * Attaching is a trust action: the terminal gets the session's conversation and, in drive mode, sends
 * prompts and answers its permission questions. So it runs only for a person at an interactive
 * terminal who confirms it there. A caller without a terminal — a script, or a model running shell
 * commands — is refused with the command a person should run instead.
 */

import { confirmAttachOnTerminal, type IAttachConfirmation } from './attach-confirmation.js';
import { productSecureMode } from '../product/session-sealing.js';
import { createKeyringFileStore } from '../secure/keyring-store.js';
import { openOwnerAtTerminal } from '../secure/owner-at-terminal.js';
import { openSecureTerminal } from '../secure/secure-terminal.js';
import { openSecureAttach } from './secure-attach-client.js';
import { openSupervisedAttach, type ISupervisedAttachConnection } from './supervised-attach-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory } from './supervised-session-control.js';
import type { IOwnerHandover } from '@robota-sdk/agent-keyring';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Written for whoever reads `--help`, a model included: what it does, when to use it, what it
 * returns, and that only the user can run it.
 */
export const SESSION_ATTACH_HELP = (cliName: string): string =>
  `Usage: ${cliName} session attach <supervised-id> [--observe] [--screen-reader|--no-screen-reader]\n` +
  '\n' +
  `Attach this terminal to a live supervised session started with \`${cliName} session start --background\`.\n` +
  'Drive mode (the default) sends prompts and answers the session\'s questions alongside its other\n' +
  'surfaces; --observe follows the conversation read-only. Use it to check on or steer a background\n' +
  `session; find ids with \`${cliName} session list\` or \`${cliName} session view\`.\n` +
  '\n' +
  'It needs an interactive terminal and asks for confirmation there; in secure mode the owner unlocks\n' +
  'with a passphrase instead, so only the user can run it; a script or an agent should suggest the command instead.\n' +
  'Detach with /exit, Ctrl-C or\n' +
  'Ctrl-]: the session keeps running. Exits 0 after detaching, 1 when it could not attach.\n';

/** An admitted attach: the protocol connection and the driver id the session assigned it. */
export interface IOpenAttach {
  readonly connection: Omit<ISupervisedAttachConnection, 'detach' | 'driverId'>;
  readonly driverId: string;
}

/** What renders the full terminal UI on an admitted attach, in the role the user confirmed. */
export interface IAttachedAppRenderOptions extends IOpenAttach {
  readonly mode: 'drive' | 'observe';
  readonly sessionLabel: string;
  /** `--screen-reader` / `--no-screen-reader`; `undefined` when neither was given. */
  readonly screenReaderFlag: boolean | undefined;
  /** Print the screen-reader line; false when this process already printed it. */
  readonly announce?: boolean;
}

/** Renders the attached terminal UI until it ends; resolves how it ended. */
export type TAttachedAppRender = (options: IAttachedAppRenderOptions) => Promise<'user' | 'closed'>;

export interface IConfirmedAttach {
  readonly id: string;
  readonly mode: 'drive' | 'observe';
  /** The process start the user confirmed; a restart since then is refused. */
  readonly generation: string;
  readonly root: string;
  /** Run the terminal's view on the open connection; resolves how it ended. */
  readonly render: (attach: IOpenAttach) => Promise<'user' | 'closed'>;
  /** Printed once the view ended: the user left, or the session closed the connection. */
  readonly messages: { readonly detached: string; readonly closed: string };
  readonly open?: typeof openSupervisedAttach;
}

/** Attach after the user said yes, run the view until it ends, and always detach. */
export async function runConfirmedAttach(attach: IConfirmedAttach): Promise<number> {
  let connection: ISupervisedAttachConnection;
  try {
    connection = await (attach.open ?? openSupervisedAttach)(attach.id, attach.mode, attach.root, attach.generation);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unable to attach.'}\n`);
    return 1;
  }
  let ended: 'user' | 'closed';
  let detachFailure: unknown;
  try {
    ended = await attach.render({
      connection: { send: connection.send, subscribe: connection.subscribe, onClose: connection.onClose },
      driverId: connection.driverId,
    });
  } finally {
    try { await connection.detach(); } catch (error) { detachFailure = error; }
  }
  if (detachFailure !== undefined) {
    process.stderr.write(`${detachFailure instanceof Error ? detachFailure.message : 'Unable to confirm detach.'}\n`);
    return 1;
  }
  process.stdout.write(`${ended === 'closed' ? attach.messages.closed : attach.messages.detached}\n`);
  return 0;
}

/** What to print when an attach to a supervised session ends. */
export function supervisedSessionAttachMessages(id: string, cliName: string): IConfirmedAttach['messages'] {
  return {
    closed: `Supervised session ${id} closed the connection (it stopped, or cut this terminal off).`,
    detached: `Detached from ${id}. It keeps running; stop it with ${cliName} session stop ${id} or from ${cliName} session view.`,
  };
}

export interface ISessionAttachCommandOptions {
  readonly productRuntime: ICliRuntimeContext;
  readonly isTTY?: boolean;
  readonly root?: string;
  /** Supplied by the interactive CLI; resolves how the terminal UI ended. */
  readonly render?: TAttachedAppRender;
  readonly confirm?: (question: IAttachConfirmation) => Promise<boolean>;
  readonly openSecureOwner?: () => Promise<IOwnerHandover | undefined>;
}

export async function runSessionAttachCommand(
  argv: readonly string[],
  options: ISessionAttachCommandOptions,
): Promise<number> {
  const cliName = options.productRuntime.vocabulary.cliName;
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(SESSION_ATTACH_HELP(cliName));
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
    process.stderr.write(SESSION_ATTACH_HELP(cliName));
    return 1;
  }
  const mode = observe ? 'observe' : 'drive';
  const command = `${cliName} session attach ${id}${observe ? ' --observe' : ''}`;
  if (!(options.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true))) {
    process.stderr.write(
      'Attaching needs an interactive terminal and the user\'s confirmation. ' +
        `Ask the user to run: ${command}\n`,
    );
    return 1;
  }
  const render = options.render;
  if (render === undefined) {
    process.stderr.write(`${cliName} session attach needs the interactive CLI; this runtime has no terminal UI.\n`);
    return 1;
  }
  const screenReaderFlag = screenReaderFlags.length === 0 ? undefined : screenReaderFlags[0] === '--screen-reader';
  const root = options.root ?? resolveSupervisedDirectory(options.productRuntime);
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
  if (productSecureMode(options.productRuntime)) {
    const product = options.productRuntime;
    let owner: IOwnerHandover | undefined;
    try {
      owner = await (options.openSecureOwner ?? (() => openOwnerAtTerminal({
        store: createKeyringFileStore({ path: product.layout.userPaths.keyring, root: product.layout.userRoot }),
        terminal: openSecureTerminal(), purpose: `attach to ${id}`,
        report: (message) => process.stderr.write(`${message}\n`),
      })))();
      if (owner === undefined) {
        process.stderr.write('Attach cancelled: secure mode needs an unlock.\n');
        return 1;
      }
      const handover = owner;
      return await runConfirmedAttach({
        id, mode, generation: row.generation, root,
        open: async (selectedId, selectedMode, selectedRoot, generation) => {
          if (generation === undefined) throw new Error('Secure attach needs a runtime generation.');
          return openSecureAttach({ id: selectedId, mode: selectedMode, root: selectedRoot, generation, handover,
            onMismatch: () => process.stderr.write('Warning: the runtime keyring sealing key differs from the unlocked key. Run secure verify to investigate.\n') });
        },
        render: (open) => render({ ...open, mode, sessionLabel: id, screenReaderFlag }),
        messages: supervisedSessionAttachMessages(id, cliName),
      });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Unable to attach.'}\n`);
      return 1;
    } finally { owner?.dispose(); }
  }
  const question: IAttachConfirmation = { id, ...(row.name !== undefined ? { name: row.name } : {}), mode };
  if (!(await (options.confirm ?? confirmAttachOnTerminal)(question))) {
    process.stderr.write('Attach cancelled.\n');
    return 1;
  }
  // Bound to the generation the user confirmed: a restart in the meantime is a different session.
  const sessionLabel = row.name ?? id;
  return runConfirmedAttach({
    id, mode, generation: row.generation, root,
    render: (open) => render({ ...open, mode, sessionLabel, screenReaderFlag }),
    messages: supervisedSessionAttachMessages(id, cliName),
  });
}
