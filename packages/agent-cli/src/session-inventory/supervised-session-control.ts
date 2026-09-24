import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';

import { admitLocalPeerDirectory, ensureGuardedDirectory } from '@robota-sdk/agent-remote-pairing/local';

import { readProcessStartTime } from '../remote-control/local-peer-registry.js';
import { resolveRendezvousDirectory } from '../remote-control/local-peer-rendezvous.js';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_FRAME_BYTES = 4_096;
const REQUEST_TIMEOUT_MS = 2_000;
const MAX_ENTRIES = 256;

interface IRegistration {
  readonly id: string;
  readonly pid: number;
  readonly startedAt: string;
}

export interface ISupervisedSessionRow {
  readonly id: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  readonly control: 'available' | 'unavailable';
}

function probePid(pid: number): 'present' | 'absent' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'present';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown';
  }
}

export function resolveSupervisedDirectory(): string {
  return join(dirname(resolveRendezvousDirectory()), 'supervised');
}

function verifyExistingDirectory(directory: string): void {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== (process.getuid?.() ?? 0) || (stat.mode & 0o077) !== 0) {
    throw new Error('Supervised session directory is not private to this user.');
  }
  const admission = admitLocalPeerDirectory(directory, { expectedUid: process.getuid?.() ?? 0 });
  if (!admission.admitted) throw new Error('Supervised session directory was refused.');
}

function ensurePrivateDirectory(directory: string): void {
  try {
    verifyExistingDirectory(directory);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const admission = ensureGuardedDirectory(directory, { expectedUid: process.getuid?.() ?? 0 });
  if (!admission.admitted) throw new Error('Unable to create a private supervised session directory.');
  verifyExistingDirectory(directory);
}

function sessionDirectory(root: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid supervised session ID.');
  return join(root, id);
}

function controlSocketPath(root: string, id: string): string {
  const name = createHash('sha256').update(id).digest('hex').slice(0, 16);
  const socketPath = join(root, `${name}.sock`);
  // macOS truncates overlong Unix-domain paths on some Node/runtime combinations.
  if (Buffer.byteLength(socketPath, 'utf8') > 100) {
    throw new Error('Supervised session control directory is too long for a local socket.');
  }
  return socketPath;
}

function readRegistration(directory: string, id: string): IRegistration {
  verifyExistingDirectory(directory);
  const file = join(directory, 'state.json');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== (process.getuid?.() ?? 0) || (stat.mode & 0o077) !== 0 || stat.size > MAX_FRAME_BYTES) {
    throw new Error('Supervised session record was refused.');
  }
  const record = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (typeof record !== 'object' || record === null ||
    !('id' in record) || record.id !== id ||
    !('pid' in record) || !Number.isSafeInteger(record.pid) || Number(record.pid) <= 0 ||
    !('startedAt' in record) || typeof record.startedAt !== 'string') {
    throw new Error('Supervised session record is invalid.');
  }
  return record as IRegistration;
}

function readLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = '';
    let done = false;
    const timer = setTimeout(() => finish(() => reject(new Error('Supervised session control timed out.'))), REQUEST_TIMEOUT_MS);
    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      action();
    };
    const onData = (chunk: string): void => {
      received += chunk;
      if (Buffer.byteLength(received, 'utf8') > MAX_FRAME_BYTES) {
        finish(() => reject(new Error('Supervised session control frame is too large.')));
        return;
      }
      const end = received.indexOf('\n');
      if (end !== -1) finish(() => resolve(received.slice(0, end)));
    };
    const onError = (): void => finish(() => reject(new Error('Supervised session control is unavailable.')));
    const onEnd = (): void => finish(() => reject(new Error('Supervised session control closed before replying.')));
    socket.setEncoding('utf8');
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

async function request(directory: string, id: string, command: 'status' | 'stop'): Promise<unknown> {
  verifyExistingDirectory(directory);
  const socketPath = controlSocketPath(dirname(directory), id);
  const info = lstatSync(socketPath);
  if (!info.isSocket() || info.uid !== (process.getuid?.() ?? 0)) throw new Error('Supervised session control socket was refused.');
  const socket = createConnection(socketPath);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', () => reject(new Error('Supervised session control is unavailable.')));
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => reject(new Error('Supervised session control timed out.')));
    });
    socket.write(`${JSON.stringify({ command, id })}\n`);
    return JSON.parse(await readLine(socket)) as unknown;
  } finally {
    socket.destroy();
  }
}

export async function listSupervisedSessions(root = resolveSupervisedDirectory()): Promise<readonly ISupervisedSessionRow[]> {
  try {
    verifyExistingDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = readdirSync(root).filter((name) => ID_PATTERN.test(name));
  if (names.length > MAX_ENTRIES) throw new Error('Too many supervised session records to list safely.');
  const rows = await Promise.all(names.map(async (id): Promise<ISupervisedSessionRow> => {
    const directory = sessionDirectory(root, id);
    const record = readRegistration(directory, id);
    const currentStart = readProcessStartTime(record.pid);
    const liveness = currentStart === undefined
      ? probePid(record.pid) === 'absent' ? 'dead' : 'unknown'
      : currentStart === record.startedAt ? 'alive' : 'dead';
    if (liveness !== 'alive') return { id, liveness, control: 'unavailable' };
    try {
      const response = await request(directory, id, 'status');
      if (typeof response === 'object' && response !== null && 'id' in response && response.id === id &&
        'status' in response && response.status === 'running') {
        return { id, liveness, control: 'available' };
      }
    } catch {
      // A registered process can lose its control endpoint during shutdown.
    }
    return { id, liveness, control: 'unavailable' };
  }));
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function stopSupervisedSession(id: string, root = resolveSupervisedDirectory()): Promise<void> {
  const directory = sessionDirectory(root, id);
  const record = readRegistration(directory, id);
  const currentStart = readProcessStartTime(record.pid);
  if (currentStart === undefined || currentStart !== record.startedAt) {
    throw new Error('Supervised session is not proven alive.');
  }
  const response = await request(directory, id, 'stop');
  if (typeof response !== 'object' || response === null || !('id' in response) || response.id !== id ||
    !('status' in response) || response.status !== 'stopping') {
    throw new Error('Supervised session did not confirm shutdown.');
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    let registrationRemoved = false;
    try {
      lstatSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') registrationRemoved = true;
      else throw error;
    }
    const startedAt = readProcessStartTime(record.pid);
    const originalProcessExited = startedAt === undefined
      ? probePid(record.pid) === 'absent'
      : startedAt !== record.startedAt;
    if (registrationRemoved && originalProcessExited) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Supervised session accepted stop but did not finish shutdown.');
}

export interface ISupervisedControl {
  close(): Promise<void>;
}

export async function startSupervisedControl(
  id: string,
  onStop: () => void,
  root = resolveSupervisedDirectory(),
): Promise<ISupervisedControl> {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid supervised session ID.');
  ensurePrivateDirectory(root);
  const directory = sessionDirectory(root, id);
  const socketPath = controlSocketPath(root, id);
  mkdirSync(directory, { mode: 0o700 });
  verifyExistingDirectory(directory);
  const clients = new Set<Socket>();
  const server: Server = createServer((socket) => {
    clients.add(socket);
    // readLine owns request errors only; write-side EPIPE can arrive after its listener is removed.
    socket.on('error', () => socket.destroy());
    socket.once('close', () => clients.delete(socket));
    void readLine(socket).then((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        socket.end(`${JSON.stringify({ id, status: 'refused' })}\n`);
        return;
      }
      if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== id || !('command' in value)) {
        socket.end(`${JSON.stringify({ id, status: 'refused' })}\n`);
        return;
      }
      if (value.command === 'status') {
        socket.end(`${JSON.stringify({ id, status: 'running' })}\n`);
      } else if (value.command === 'stop') {
        socket.once('finish', onStop);
        socket.end(`${JSON.stringify({ id, status: 'stopping' })}\n`);
      } else {
        socket.end(`${JSON.stringify({ id, status: 'refused' })}\n`);
      }
    }).catch(() => socket.destroy());
  });
  let bound = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    bound = true;
    const startedAt = readProcessStartTime(process.pid);
    if (!startedAt) throw new Error('Unable to prove supervised session process identity.');
    const registration: IRegistration = {
      id,
      pid: process.pid,
      startedAt,
    };
    writeFileSync(join(directory, 'state.json'), JSON.stringify(registration), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    server.close();
    if (bound) rmSync(socketPath, { force: true });
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(socketPath, { force: true });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
