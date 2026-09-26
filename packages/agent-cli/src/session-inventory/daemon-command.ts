import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';

import {
  connectSupervisedDaemon,
  listSupervisedSessions,
  stopSupervisedSession,
  type ISupervisedSessionRow,
} from './supervised-session-control.js';
import { launchSupervisedSession } from './supervised-session-launch.js';

export const DAEMON_USAGE =
  'Usage: robota daemon start [--json]\n' +
  '       robota daemon status [--json]\n' +
  '       robota daemon stop\n';

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
}

type TAction = { readonly action: 'start' | 'status'; readonly json: boolean } | { readonly action: 'stop' };

function parseDaemonArgs(args: readonly string[]): TAction | undefined {
  const [action, flag, extra] = args;
  if (action === 'stop') return args.length === 1 ? { action } : undefined;
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
  const connect = options.connect ?? connectSupervisedDaemon;
  try {
    const workspace = realpathSync(options.cwd);
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
        ? `${JSON.stringify({
            running: true, id: running.id, url: await connect(running.id, options.root, running.generation),
          })}\n`
        : `Daemon ${running.id} running in ${workspace}.\n`);
      return 0;
    }
    let id: string;
    let url: string;
    if (running !== undefined) {
      id = running.id;
      url = await connect(id, options.root, running.generation);
    } else {
      await options.admit(workspace);
      // The token reaches the child only through its environment, never its command line. With a
      // token the transport also accepts the desktop app's `file://` origin. The port is left to
      // the transport's default so a busy one is retried.
      const env: NodeJS.ProcessEnv = { ...options.env(), ROBOTA_WS_TOKEN: randomBytes(32).toString('hex') };
      delete env['ROBOTA_WS_PORT'];
      id = await (options.launch ?? launchSupervisedSession)(workspace, { env, daemon: true });
      url = await connect(id, options.root);
    }
    options.stdout(parsed.json
      ? `${JSON.stringify({ id, url })}\n`
      : `Daemon ${id} ${running !== undefined ? 'running' : 'started'} in ${workspace}.\n`);
    return 0;
  } catch (error) {
    options.stderr(`${error instanceof Error ? error.message : 'The daemon command failed.'}\n`);
    return 1;
  }
}
