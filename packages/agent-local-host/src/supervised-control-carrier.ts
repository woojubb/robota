import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';

import { readProcessStartTime as readCoreProcessStartTime } from '@robota-sdk/agent-core/node';
import { admitLocalPeerDirectory, ensureGuardedDirectory } from '@robota-sdk/agent-remote-pairing/local';
import { connectWindowsControlPipe, windowsControlPipePath, type IControlChannel } from './windows-control-pipe.js';
import { assertWindowsPrivatePath, createWindowsPrivateDirectory, readWindowsProcessStartTime } from './windows-security.js';

export const SUPERVISED_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const MAX_CONTROL_FRAME_BYTES = 4_096;
const GENERATION_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
export interface IRegistration {
  readonly id: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly generation?: string;
}
export function isGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION_PATTERN.test(value);
}
function readProcessStartTime(pid: number): string | undefined {
  return readCoreProcessStartTime(pid, { readWindows: readWindowsProcessStartTime });
}

export function verifyExistingDirectory(directory: string): void {
  const stat = lstatSync(directory);
  if (process.platform === 'win32') {
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Supervised session directory was refused.');
    assertWindowsPrivatePath(directory, true);
    return;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== (process.getuid?.() ?? 0) || (stat.mode & 0o077) !== 0) {
    throw new Error('Supervised session directory is not private to this user.');
  }
  const admission = admitLocalPeerDirectory(directory, { expectedUid: process.getuid?.() ?? 0 });
  if (!admission.admitted) throw new Error('Supervised session directory was refused.');
}

export function ensurePrivateDirectory(directory: string): void {
  try {
    verifyExistingDirectory(directory);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (process.platform === 'win32') {
    createWindowsPrivateDirectory(directory);
    verifyExistingDirectory(directory);
    return;
  }
  const admission = ensureGuardedDirectory(directory, { expectedUid: process.getuid?.() ?? 0 });
  if (!admission.admitted) throw new Error('Unable to create a private supervised session directory.');
  verifyExistingDirectory(directory);
}

export function sessionDirectory(root: string, id: string): string {
  if (!SUPERVISED_ID_PATTERN.test(id)) throw new Error('Invalid supervised session ID.');
  return join(root, id);
}

// macOS truncates overlong Unix-domain paths on some Node/runtime combinations.
const MAX_SOCKET_PATH_BYTES = 100;

/** The supervised directory is too deep for a Unix-domain socket; the message says how to move it. */
export class SupervisedControlPathTooLongError extends Error {
  constructor(readonly directory: string) {
    super(`Supervised session control socket path is too long under ${directory}: a local socket path ` +
      `allows ${MAX_SOCKET_PATH_BYTES} bytes. Set PRODUCT_USER_STATE_DIR to a shorter absolute path, or set XDG_RUNTIME_DIR to a short ` +
      'private directory for every CLI command.');
    this.name = 'SupervisedControlPathTooLongError';
  }
}

export function controlSocketPath(root: string, id: string): string {
  if (process.platform === 'win32') return windowsControlPipePath(root, id);
  const name = createHash('sha256').update(id).digest('hex').slice(0, 16);
  const socketPath = join(root, `${name}.sock`);
  if (Buffer.byteLength(socketPath, 'utf8') > MAX_SOCKET_PATH_BYTES) {
    throw new SupervisedControlPathTooLongError(root);
  }
  return socketPath;
}

/**
 * Read a regular file this user owns, never through a link. The checks run on the descriptor that
 * is then read, so a file swapped in at the path after they pass is never the one read; a FIFO is
 * refused without blocking. Anything that fails a check throws `refusal`; a missing file throws the
 * system error, so callers can still tell ENOENT apart.
 */
export function readOwnedFile(
  file: string,
  rules: { readonly ownerOnly: boolean; readonly maxBytes?: number; readonly refusal: string },
): string {
  if (process.platform === 'win32') {
    verifyExistingDirectory(dirname(file));
    assertWindowsPrivatePath(file, false);
  }
  let fd: number;
  try {
    // The mode is a no-op without O_CREAT; it is passed so the open states an owner-only mode,
    // which is what static analysis looks for on an open.
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Not a regular file: a link under O_NOFOLLOW (ELOOP; EMLINK on some BSDs) or a socket.
    if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENXIO' || code === 'EOPNOTSUPP') {
      throw new Error(rules.refusal);
    }
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.uid !== (process.getuid?.() ?? 0) ||
      (rules.ownerOnly && (stat.mode & 0o077) !== 0))) ||
      (rules.maxBytes !== undefined && stat.size > rules.maxBytes)) {
      throw new Error(rules.refusal);
    }
    // The size is checked again on what was read: the file may have grown since `fstat`.
    const bytes = readFileSync(fd);
    if (rules.maxBytes !== undefined && bytes.length > rules.maxBytes) throw new Error(rules.refusal);
    return bytes.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function readRegistration(directory: string, id: string): IRegistration {
  verifyExistingDirectory(directory);
  const record = JSON.parse(readOwnedFile(join(directory, 'state.json'), {
    ownerOnly: true, maxBytes: MAX_CONTROL_FRAME_BYTES, refusal: 'Supervised session record was refused.',
  })) as unknown;
  if (typeof record !== 'object' || record === null ||
    !('id' in record) || record.id !== id ||
    !('pid' in record) || !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0 ||
    !('startedAt' in record) || typeof record.startedAt !== 'string' ||
    ('generation' in record && !isGeneration(record.generation))) {
    throw new Error('Supervised session record is invalid.');
  }
  return {
    id, pid: Number(record.pid), startedAt: record.startedAt,
    ...('generation' in record && isGeneration(record.generation) ? { generation: record.generation } : {}),
  };
}

export async function connectControlSocket(directory: string, id: string, signal?: AbortSignal): Promise<IControlChannel> {
  verifyExistingDirectory(directory);
  const socketPath = controlSocketPath(dirname(directory), id);
  if (process.platform === 'win32') return connectWindowsControlPipe(socketPath, readRegistration(directory, id), signal);
  const info = lstatSync(socketPath);
  if (!info.isSocket() || info.uid !== (process.getuid?.() ?? 0)) throw new Error('Supervised session control socket was refused.');
  return createConnection(socketPath);
}


export function verifyLiveOwner(
  root: string,
  id: string,
  expectedGeneration?: string,
): { readonly directory: string; readonly record: IRegistration; readonly generation: string } {
  const directory = sessionDirectory(root, id);
  const record = readRegistration(directory, id);
  if (record.generation === undefined) throw new Error('Supervised session registration cannot be controlled.');
  if (expectedGeneration !== undefined && record.generation !== expectedGeneration) {
    throw new Error('Supervised session changed since it was listed.');
  }
  const currentStart = readProcessStartTime(record.pid);
  if (currentStart === undefined || currentStart !== record.startedAt) {
    throw new Error('Supervised session is not proven alive.');
  }
  return { directory, record, generation: record.generation };
}

/** Revalidate the selected runtime start before connecting its owner-link carrier. */
export async function openRegisteredControlStream(
  root: string,
  id: string,
  generation: string,
  signal?: AbortSignal,
): Promise<IControlChannel> {
  signal?.throwIfAborted();
  const live = verifyLiveOwner(root, id, generation);
  return connectControlSocket(live.directory, id, signal);
}
