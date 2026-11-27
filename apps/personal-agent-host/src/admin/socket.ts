import { connect } from 'node:net';
import type { Server } from 'node:http';
import { chmod, lstat, mkdir, rmdir, stat, unlink } from 'node:fs/promises';

import { HostError } from '../errors.js';
import { isNotFound, PRIVATE_DIR_MODE } from '../fs-util.js';
import type { IAdminPaths } from './paths.js';

const PROBE_TIMEOUT_MS = 2_000;
/** A takeover lock older than this was left by a process that died in the middle of it. */
const TAKEOVER_STALE_MS = 10_000;
const SOCKET_MODE = 0o600;

type Probe = 'free' | 'stale' | 'live';

function alreadyRunning(socket: string): HostError {
  return new HostError(
    'conflict',
    `Another control plane is already serving ${socket}; stop it first, or use another state directory`,
  );
}

/**
 * Tells a live daemon from a dead one's leftover file by connecting: a listener accepts, a socket
 * file with nobody behind it refuses. Anything else (a regular file, another user's socket, a
 * connection that never answers) is not ours to remove, so it is refused rather than guessed at.
 */
async function probe(socket: string): Promise<Probe> {
  let info;
  try {
    info = await lstat(socket);
  } catch (error) {
    if (isNotFound(error)) return 'free';
    throw error;
  }
  if (!info.isSocket()) {
    throw new HostError('config-invalid', `${socket} exists and is not a socket; not touching it`);
  }
  if (process.getuid && info.uid !== process.getuid()) {
    throw new HostError('config-invalid', `${socket} belongs to another user; not touching it`);
  }
  return new Promise<Probe>((resolve, reject) => {
    const client = connect(socket);
    const timer = setTimeout(() => {
      client.destroy();
      reject(
        new HostError('conflict', `${socket} did not answer; refusing to remove it while unsure`),
      );
    }, PROBE_TIMEOUT_MS);
    client.once('connect', () => {
      clearTimeout(timer);
      client.destroy();
      resolve('live');
    });
    client.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === 'ECONNREFUSED') resolve('stale');
      else if (error.code === 'ENOENT') resolve('free');
      else reject(new HostError('config-invalid', `Cannot probe ${socket}: ${error.message}`));
    });
  });
}

/** Creates the socket directory owner-only, or checks the one that exists; never loosens it. */
async function prepareDir(dir: string): Promise<void> {
  const previous = process.umask(0o077);
  try {
    await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  } finally {
    process.umask(previous);
  }
  const info = await lstat(dir);
  if (!info.isDirectory()) {
    throw new HostError('config-invalid', `${dir} is not a directory`);
  }
  if (process.getuid && info.uid !== process.getuid()) {
    throw new HostError('config-invalid', `${dir} belongs to another user; refusing to use it`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new HostError(
      'config-invalid',
      `${dir} is accessible to other users (mode ${(info.mode & 0o777).toString(8)}); run chmod 700 on it`,
    );
  }
}

/** Only one process at a time may replace a stale socket, so two starts cannot remove each other's. */
async function withTakeoverLock<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const lock = `${dir}/.takeover`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(lock, { mode: PRIVATE_DIR_MODE });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = Date.now() - (await stat(lock).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
      if (attempt > 0 || age < TAKEOVER_STALE_MS) {
        throw new HostError('conflict', 'Another control plane is starting; try again');
      }
      await rmdir(lock).catch(() => undefined);
    }
  }
  try {
    return await task();
  } finally {
    await rmdir(lock).catch(() => undefined);
  }
}

function listen(server: Server, socket: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    // The mode a socket file gets at bind time follows the umask, so it is never open even briefly.
    const previous = process.umask(0o177);
    try {
      server.listen(socket, () => {
        server.off('error', onError);
        resolve();
      });
    } catch (error) {
      reject(error);
    } finally {
      process.umask(previous);
    }
  });
}

export interface IBoundSocket {
  /** Removes the socket file if it is still the one this process bound. */
  release(): Promise<void>;
}

/**
 * Binds the admin socket. The bind is the single-instance lock: the second server fails here, and
 * a socket left behind by a dead one is replaced only after a connection to it was refused.
 */
export async function bindAdminSocket(server: Server, paths: IAdminPaths): Promise<IBoundSocket> {
  await prepareDir(paths.dir);
  const state = await probe(paths.socket);
  if (state === 'live') throw alreadyRunning(paths.socket);
  try {
    if (state === 'stale') {
      await withTakeoverLock(paths.dir, async () => {
        if ((await probe(paths.socket)) === 'live') throw alreadyRunning(paths.socket);
        await unlink(paths.socket).catch((error: unknown) => {
          if (!isNotFound(error)) throw error;
        });
        await listen(server, paths.socket);
      });
    } else {
      await listen(server, paths.socket);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw alreadyRunning(paths.socket);
    throw error;
  }
  await chmod(paths.socket, SOCKET_MODE);
  const bound = await lstat(paths.socket);
  return {
    release: async () => {
      try {
        const current = await lstat(paths.socket);
        if (current.ino === bound.ino && current.dev === bound.dev) await unlink(paths.socket);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}
