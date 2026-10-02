import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';

import {
  acquireSupervisedDaemonStartLock,
  resolveSupervisedDirectory,
  connectSupervisedDaemon,
  listSupervisedSessions,
  removeSupervisedDaemonStartLock,
  stopSupervisedSession,
  type ISupervisedSessionRow,
} from './supervised-session-control.js';
import { launchSupervisedSession } from './supervised-session-launch.js';

export const DAEMON_USAGE = (cliName: string): string =>
  `Usage: ${cliName} daemon start [--json] [--restricted-workspace]\n` +
  `       ${cliName} daemon status [--json]\n` +
  `       ${cliName} daemon stop\n` +
  `       ${cliName} daemon unlock\n`;

export interface IDaemonCommandOptions {
  readonly productRuntime: ICliRuntimeContext;
  /** The directory the command runs in; its real path names the workspace. */
  readonly cwd: string;
  /** The environment a started daemon inherits; the transport token is added to it here. */
  readonly env: (workspace: string) => NodeJS.ProcessEnv;
  /**
   * Throws, with the message to show, when a daemon may not start in this workspace. `restricted` is
   * a person's choice to start it without the project's own configuration.
   */
  readonly admit: (workspace: string, start: { readonly restricted: boolean }) => Promise<void>;
  /** Whether the workspace is trusted now, so a daemon started in it would load the project's configuration. */
  readonly trusted: (workspace: string) => Promise<boolean>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly root?: string;
  readonly list?: typeof listSupervisedSessions;
  readonly connect?: typeof connectSupervisedDaemon;
  readonly launch?: typeof launchSupervisedSession;
  readonly stop?: typeof stopSupervisedSession;
  /** Serializes starts in one workspace; resolves to the release. */
  readonly lock?: typeof acquireSupervisedDaemonStartLock;
}

type TAction =
  | { readonly action: 'start'; readonly json: boolean; readonly restricted: boolean }
  | { readonly action: 'status'; readonly json: boolean }
  | { readonly action: 'stop' }
  | { readonly action: 'unlock' };

const START_FLAGS: ReadonlySet<string> = new Set(['--json', '--restricted-workspace']);

function parseDaemonArgs(args: readonly string[]): TAction | undefined {
  const [action, ...flags] = args;
  if (action === 'stop' || action === 'unlock') return args.length === 1 ? { action } : undefined;
  const allowed = action === 'start' ? START_FLAGS : new Set(['--json']);
  if (action !== 'start' && action !== 'status') return undefined;
  if (flags.some((flag) => !allowed.has(flag)) || new Set(flags).size !== flags.length) return undefined;
  const json = flags.includes('--json');
  return action === 'start'
    ? { action, json, restricted: flags.includes('--restricted-workspace') }
    : { action, json };
}

/** A workspace's live daemon, bound to the process start it was listed with. */
export type TWorkspaceDaemon = ISupervisedSessionRow & { readonly generation: string };

/**
 * The live daemon of `workspace` (a real path), the first by id when more than one answers. Every
 * command that reaches "this workspace's daemon" finds it here, so they cannot disagree about which.
 */
export async function findWorkspaceDaemon(
  workspace: string,
  lookup: { readonly root: string; readonly list?: typeof listSupervisedSessions },
): Promise<TWorkspaceDaemon | undefined> {
  const rows = await (lookup.list ?? listSupervisedSessions)(lookup.root, undefined, {
    cwd: workspace, includeCwd: true, includeGeneration: true, includeDaemon: true, includeName: true,
  });
  return rows
    .filter((row): row is TWorkspaceDaemon =>
      row.daemon === true && row.liveness === 'alive' && row.control === 'available' &&
      row.cwd === workspace && row.generation !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}

function findDaemon(options: IDaemonCommandOptions, workspace: string): Promise<TWorkspaceDaemon | undefined> {
  return findWorkspaceDaemon(workspace, { ...options, root: options.root ?? resolveSupervisedDirectory(options.productRuntime) });
}

/** A running daemon that cannot hand over its connection blocks every later start until it is stopped. */
async function connectRunning(
  options: IDaemonCommandOptions,
  running: TWorkspaceDaemon,
): Promise<string> {
  const cliName = options.productRuntime.vocabulary.cliName;
  try {
    return await (options.connect ?? connectSupervisedDaemon)(running.id, (options.root ?? resolveSupervisedDirectory(options.productRuntime)), running.generation);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The daemon did not hand over its connection.';
    throw new Error(`${reason} Daemon ${running.id} is running but cannot be connected to. Run: ${cliName} daemon stop`);
  }
}

/** Launch this workspace's daemon; one that cannot hand over its connection is stopped again. */
async function launchDaemon(
  options: IDaemonCommandOptions,
  workspace: string,
  restricted: boolean,
): Promise<{ readonly id: string; readonly url: string }> {
  await options.admit(workspace, { restricted });
  // The token reaches the child only through its environment, never its command line. With a
  // token the transport also accepts the desktop app's `file://` origin. The port is left to
  // the transport's default so a busy one is retried.
  const env: NodeJS.ProcessEnv = { ...options.env(workspace), PRODUCT_WS_TOKEN: randomBytes(32).toString('hex') };
  delete env['PRODUCT_WS_PORT'];
  const id = await (options.launch ?? launchSupervisedSession)(workspace, {
    env,
    productRuntime: options.productRuntime,
    root: options.root ?? resolveSupervisedDirectory(options.productRuntime),
    daemon: true,
    ...(restricted ? { restricted: true } : {}),
  });
  try {
    return { id, url: await (options.connect ?? connectSupervisedDaemon)(id, (options.root ?? resolveSupervisedDirectory(options.productRuntime))) };
  } catch (error) {
    try {
      const rows = await (options.list ?? listSupervisedSessions)((options.root ?? resolveSupervisedDirectory(options.productRuntime)), undefined, {
        cwd: workspace, includeGeneration: true,
      });
      const started = rows.find((row) => row.id === id);
      await (options.stop ?? stopSupervisedSession)(id, (options.root ?? resolveSupervisedDirectory(options.productRuntime)), started?.generation);
    } catch {
      // Best effort: the start already failed and says so below.
    }
    throw error;
  }
}

/**
 * `the CLI daemon start|status|stop`: one supervised runtime per workspace that a client, the desktop
 * app first, connects to over WebSocket instead of spawning a runtime of its own. The token-bearing
 * URL is printed only with `--json`, for the program that connects.
 */
export async function runDaemonCommand(
  args: readonly string[],
  options: IDaemonCommandOptions,
): Promise<number> {
  const cliName = options.productRuntime.vocabulary.cliName;
  const parsed = parseDaemonArgs(args);
  if (parsed === undefined) {
    options.stderr(DAEMON_USAGE(cliName));
    return 1;
  }
  try {
    const workspace = realpathSync(options.cwd);
    if (parsed.action === 'unlock') {
      // Only at the user's request: a start never removes a lock it did not take.
      const removed = removeSupervisedDaemonStartLock(workspace, (options.root ?? resolveSupervisedDirectory(options.productRuntime)));
      if (removed.outcome === 'held') {
        options.stderr(`A daemon start (process ${removed.pid}) is still running in ${workspace}; its lock was kept.\n`);
        return 1;
      }
      options.stdout(removed.outcome === 'removed'
        ? `Removed the daemon start lock in ${workspace}.\n`
        : `No daemon start lock in ${workspace}.\n`);
      return 0;
    }
    const running = await findDaemon(options, workspace);
    if (parsed.action === 'stop') {
      if (running === undefined) {
        options.stdout(`No daemon is running in ${workspace}.\n`);
        return 0;
      }
      await (options.stop ?? stopSupervisedSession)(running.id, (options.root ?? resolveSupervisedDirectory(options.productRuntime)), running.generation);
      options.stdout(`Stopped daemon ${running.id}.\n`);
      return 0;
    }
    if (parsed.action === 'status') {
      if (running === undefined) {
        options.stdout(parsed.json ? `${JSON.stringify({ running: false })}\n` : `No daemon is running in ${workspace}.\n`);
        return 0;
      }
      options.stdout(parsed.json
        ? `${JSON.stringify({ running: true, id: running.id, url: await connectRunning(options, running) })}\n`
        : `Daemon ${running.id} running in ${workspace}.\n`);
      return 0;
    }
    let started = false;
    let id: string;
    let url: string;
    // A Restricted start was a person's choice and never gets a daemon with the project's
    // configuration. A plain start takes a Restricted daemon unless the folder is trusted now: the
    // person who trusted it expects that configuration, and anywhere else a new daemon would not
    // have it either.
    const refuseMismatch = async (daemon: TWorkspaceDaemon): Promise<void> => {
      if (parsed.restricted && daemon.restricted !== true) {
        throw new Error(
          `Daemon ${daemon.id} is running in ${workspace} with the project's configuration, so it cannot be started Restricted. Run: ${cliName} daemon stop`,
        );
      }
      if (!parsed.restricted && daemon.restricted === true && await options.trusted(workspace)) {
        throw new Error(
          `Daemon ${daemon.id} is running Restricted in ${workspace}, which is trusted now. To start it with the project's configuration, run: ${cliName} daemon stop`,
        );
      }
    };
    if (running !== undefined) {
      await refuseMismatch(running);
      id = running.id;
      url = await connectRunning(options, running);
    } else {
      // Starts in one workspace take turns; the one that waited finds the winner's daemon and reuses it.
      const release = await (options.lock ?? acquireSupervisedDaemonStartLock)(workspace, (options.root ?? resolveSupervisedDirectory(options.productRuntime)), { cliName });
      try {
        const winner = await findDaemon(options, workspace);
        if (winner !== undefined) {
          await refuseMismatch(winner);
          id = winner.id;
          url = await connectRunning(options, winner);
        } else {
          ({ id, url } = await launchDaemon(options, workspace, parsed.restricted));
          started = true;
        }
      } finally {
        release();
      }
    }
    options.stdout(parsed.json
      ? `${JSON.stringify({ id, url })}\n`
      : `Daemon ${id} ${started ? 'started' : 'running'} in ${workspace}.\n`);
    return 0;
  } catch (error) {
    options.stderr(`${error instanceof Error ? error.message : 'The daemon command failed.'}\n`);
    return 1;
  }
}
