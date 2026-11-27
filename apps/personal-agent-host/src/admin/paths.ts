import { join } from 'node:path';

import { HostError } from '../errors.js';

const DEFAULT_STATE_DIR = '/var/lib/personal-agent-host';
/** sockaddr_un holds about 104 bytes on macOS and 108 on Linux, terminator included. */
const MAX_SOCKET_PATH = 100;

export interface IAdminPaths {
  /** Directory that holds the socket; owner-only, and used for nothing else. */
  dir: string;
  socket: string;
}

/**
 * Where the admin socket lives: always inside the state directory, so the directory the server
 * restricts is one it owns. The server and the CLI resolve it the same way.
 */
export function adminPaths(env: NodeJS.ProcessEnv): IAdminPaths {
  const stateDir = (env.PERSONAL_AGENT_HOST_STATE_DIR ?? '').trim() || DEFAULT_STATE_DIR;
  if (!stateDir.startsWith('/')) {
    throw new HostError('config-invalid', 'PERSONAL_AGENT_HOST_STATE_DIR must be an absolute path');
  }
  const dir = join(stateDir, 'run');
  const socket = join(dir, 'admin.sock');
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH) {
    throw new HostError(
      'config-invalid',
      `The admin socket path ${socket} is too long for a Unix socket ` +
        `(${Buffer.byteLength(socket)} bytes, at most ${MAX_SOCKET_PATH}); use a shorter state directory`,
    );
  }
  return { dir, socket };
}
