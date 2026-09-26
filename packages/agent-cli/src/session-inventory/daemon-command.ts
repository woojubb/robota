import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';

import {
  acquireSupervisedDaemonStartLock,
  connectSupervisedDaemon,
  listSupervisedSessions,
  removeSupervisedDaemonStartLock,
  stopSupervisedSession,
  type ISupervisedSessionRow,
} from './supervised-session-control.js';
import { launchSupervisedSession } from './supervised-session-launch.js';

export const DAEMON_USAGE =
  'Usage: robota daemon start [--json]\n' +
  '       robota daemon status [--json]\n' +
  '       robota daemon stop\n' +
  '       robota daemon unlock\n';

export interface IDaemonCommandOptions {
  /** The directory the command runs in; its real path names the workspace. */
  readonly cwd: string;
  /** The environment a started daemon inherits; the transport token is added to it here. */
  readonly env: () => NodeJS.ProcessEnv;
  /** Throws, with the message to show, when a daemon may not start in this workspace. */
  readonly admit: (workspace: string) => Promise<void>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly root?: string;
  readonly list?: typeof listSupervisedSessions;
  readonly connect?: typeof connectSupervisedDaemon;
  readonly launch?: typeof launchSupervisedSession;
  readonly stop?: typeof stopSupervisedSession;
  /** Serializes starts in one workspace; resolves to the release. */
  readonly lock?: (workspace: string, root?: string) => Promise<() => void>;
}

type TAction =
  | { readonly action: 'start'; readonly json: boolean }
  | { readonly action: 'status'; readonly json: boolean }
  | { readonly action: 'stop' }
  | { readonly action: 'unlock' };

function parseDaemonArgs(args: readonly string[]): TAction | undefined {
  const [action, flag, extra] = args;
  if (action === 'stop' || action === 'unlock') return args.length === 1 ? { action } : undefined;
  if (action !== 'start' && action !== 'status') return undefined;
  if (extra !== undefined || (flag !== undefined && flag !== '--json')) return undefined;
  return { action, json: flag === '--json' };
}

/** This workspace's live daemon, the first by id when more than one answers. */
async function findDaemon(
  options: IDaemonCommandOptions,
  workspace: string,
): Promise<(ISupervisedSessionRow & { readonly generation: string }) | undefined> {
  const rows = await (options.list ?? listSupervisedSessions)(options.root, undefined, {
    cwd: workspace, includeCwd: true, includeGeneration: true, includeDaemon: true,
  });
  return rows
    .filter((row): row is ISupervisedSessionRow & { readonly generation: string } =>
      row.daemon === true && row.liveness === 'alive' && row.control === 'available' &&
      row.cwd === workspace && row.generation !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** A running daemon that cannot hand over its connection blocks every later start until it is stopped. */
async function connectRunning(
  options: IDaemonCommandOptions,
  running: ISupervisedSessionRow & { readonly generation: string },
): Promise<string> {
  try {
    return await (options.connect ?? connectSupervisedDaemon)(running.id, options.root, running.generation);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The daemon did not hand over its connection.';
    throw new Error(`${reason} Daemon ${running.id} is running but cannot be connected to. Run: robota daemon stop`);
  }
}

/** Launch this workspace's daemon; one that cannot hand over its connection is stopped again. */
async function launchDaemon(
  options: IDaemonCommandOptions,
  workspace: string,
): Promise<{ readonly id: string; readonly url: string }> {
  await options.admit(workspace);
  // The token reaches the child only through its environment, never its command line. With a
  // token the transport also accepts the desktop app's `file://` origin. The port is left to
  // the transport's default so a busy one is retried.
  const env: NodeJS.ProcessEnv = { ...options.env(), ROBOTA_WS_TOKEN: randomBytes(32).toString('hex') };
  delete env['ROBOTA_WS_PORT'];
  const id = await (options.launch ?? launchSupervisedSession)(workspace, { env, daemon: true });
  try {
    return { id, url: await (options.connect ?? connectSupervisedDaemon)(id, options.root) };
  } catch (error) {
    try {
      const rows = await (options.list ?? listSupervisedSessions)(options.root, undefined, {
        cwd: workspace, includeGeneration: true,
      });
      const started = rows.find((row) => row.id === id);
      await (options.stop ?? stopSupervisedSession)(id, options.root, started?.generation);
    } catch {
      // Best effort: the start already failed and says so below.
    }
    throw error;
  }
}

/**
 * `robota daemon start|status|stop`: one supervised runtime per workspace that a client, the desktop
 * app first, connects to over WebSocket instead of spawning a runtime of its own. The token-bearing
 * URL is printed only with `--json`, for the program that connects.
 */
export async function runDaemonCommand(
  args: readonly string[],
  options: IDaemonCommandOptions,
): Promise<number> {
  const parsed = parseDaemonArgs(args);
  if (parsed === undefined) {
    options.stderr(DAEMON_USAGE);
    return 1;
  }
  try {
    const workspace = realpathSync(options.cwd);
    if (parsed.action === 'unlock') {
      // Only at the user's request: a start never removes a lock it did not take.
      const removed = removeSupervisedDaemonStartLock(workspace, options.root);
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
      await (options.stop ?? stopSupervisedSession)(running.id, options.root, running.generation);
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
    if (running !== undefined) {
      id = running.id;
      url = await connectRunning(options, running);
    } else {
      // Starts in one workspace take turns; the one that waited finds the winner's daemon and reuses it.
      const release = await (options.lock ?? acquireSupervisedDaemonStartLock)(workspace, options.root);
      try {
        const winner = await findDaemon(options, workspace);
        if (winner !== undefined) {
          id = winner.id;
          url = await connectRunning(options, winner);
        } else {
          ({ id, url } = await launchDaemon(options, workspace));
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
