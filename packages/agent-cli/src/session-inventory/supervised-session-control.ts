import { createHash, randomBytes } from 'node:crypto';
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';

import { admitLocalPeerDirectory, ensureGuardedDirectory } from '@robota-sdk/agent-remote-pairing/local';

import { readProcessStartTime } from '../remote-control/local-peer-registry.js';
import { resolveRendezvousDirectory } from '../remote-control/local-peer-rendezvous.js';
import { createSupervisedAttachCarrier } from './supervised-attach.js';

import type { IProtocolSession } from '@robota-sdk/agent-transport';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_FRAME_BYTES = 4_096;
const MAX_STATUS_RESPONSE_BYTES = 32_768;
const REQUEST_TIMEOUT_MS = 2_000;
const MAX_ENTRIES = 256;
const MAX_NAME_BYTES = 240;
const MAX_PR_URL_BYTES = 2_048;
const NAME_CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const GENERATION_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

interface IRegistration {
  readonly id: string;
  readonly pid: number;
  readonly startedAt: string;
  /** Minted per process start; absent only in a registration written before generations existed. */
  readonly generation?: string;
}

type TControlCommand = 'status' | 'stop' | 'rename' | 'link-pr' | 'unlink-pr';

function isGeneration(value: unknown): value is string {
  return typeof value === 'string' && GENERATION_PATTERN.test(value);
}

type TSupervisedActivity = 'working' | 'needs-input' | 'idle' | 'unknown';

function isCurrentActivity(value: unknown): value is Exclude<TSupervisedActivity, 'unknown'> {
  return value === 'working' || value === 'needs-input' || value === 'idle';
}

function isLoopTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

export function isSupervisedSessionName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 &&
    value.trim() === value && !NAME_CONTROLS.test(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_NAME_BYTES;
}

export interface ISupervisedPr {
  readonly url: string;
  readonly host: string;
  readonly number: number;
  readonly kind: 'pull' | 'merge-request';
}

/** A caller-declared association, not a claim that the remote PR exists. */
export function parseSupervisedPr(value: unknown): ISupervisedPr | undefined {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_PR_URL_BYTES ||
    /[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return undefined; }
  if (parsed.protocol !== 'https:' || parsed.href !== value || parsed.username || parsed.password ||
    parsed.port || parsed.search || parsed.hash || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(parsed.hostname)) return undefined;
  const pull = /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/([1-9][0-9]*)$/u.exec(parsed.pathname);
  const merge = /^\/(?:[A-Za-z0-9_.-]+\/)+-\/merge_requests\/([1-9][0-9]*)$/u.exec(parsed.pathname);
  const match = pull ?? merge;
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number)) return undefined;
  return { url: value, host: parsed.hostname, number, kind: pull ? 'pull' : 'merge-request' };
}

function isSupervisedPr(value: unknown): value is ISupervisedPr {
  if (typeof value !== 'object' || value === null || !('url' in value)) return false;
  const parsed = parseSupervisedPr(value.url);
  return parsed !== undefined && 'host' in value && value.host === parsed.host &&
    'number' in value && value.number === parsed.number && 'kind' in value && value.kind === parsed.kind;
}

export interface ISupervisedSessionRow {
  readonly id: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  readonly control: 'available' | 'unavailable';
  readonly activity: TSupervisedActivity;
  readonly nextLoopAt?: string;
  readonly name?: string;
  readonly cwd?: string;
  readonly pr?: ISupervisedPr;
  /** Present only when requested and verified: the registration this row's actions must still address. */
  readonly generation?: string;
  readonly problem?: 'invalid-registration';
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
    !('startedAt' in record) || typeof record.startedAt !== 'string' ||
    ('generation' in record && !isGeneration(record.generation))) {
    throw new Error('Supervised session record is invalid.');
  }
  return {
    id, pid: Number(record.pid), startedAt: record.startedAt,
    ...('generation' in record && isGeneration(record.generation) ? { generation: record.generation } : {}),
  };
}

/** `onRest` receives whatever arrived after the line, for a connection that stays open. */
function readLine(
  socket: Socket,
  maxBytes = MAX_FRAME_BYTES,
  onRest?: (rest: string) => void,
): Promise<string> {
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
      const end = received.indexOf('\n');
      // The bound is on the line itself: bytes an attach client sends after it belong to the
      // session protocol, which applies its own frame limit.
      if (Buffer.byteLength(end === -1 ? received : received.slice(0, end), 'utf8') > maxBytes) {
        finish(() => reject(new Error('Supervised session control frame is too large.')));
        return;
      }
      if (end !== -1) {
        finish(() => {
          onRest?.(received.slice(end + 1));
          resolve(received.slice(0, end));
        });
      }
    };
    const onError = (): void => finish(() => reject(new Error('Supervised session control is unavailable.')));
    const onEnd = (): void => finish(() => reject(new Error('Supervised session control closed before replying.')));
    socket.setEncoding('utf8');
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

/**
 * Send one command bound to `generation`. A reply is returned only when its owner echoes that same
 * generation, so a reply from a different process start is never taken as this registration's.
 */
async function request(
  directory: string,
  id: string,
  generation: string,
  command: TControlCommand,
  signal?: AbortSignal,
  name?: string,
  url?: string,
): Promise<object> {
  signal?.throwIfAborted();
  verifyExistingDirectory(directory);
  const socketPath = controlSocketPath(dirname(directory), id);
  const info = lstatSync(socketPath);
  if (!info.isSocket() || info.uid !== (process.getuid?.() ?? 0)) throw new Error('Supervised session control socket was refused.');
  const socket = createConnection(socketPath);
  const onAbort = (): void => { socket.destroy(new Error('Supervised session control aborted.')); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', () => reject(new Error('Supervised session control is unavailable.')));
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => reject(new Error('Supervised session control timed out.')));
    });
    signal?.throwIfAborted();
    socket.write(`${JSON.stringify({ command, id, generation, ...(command === 'rename' ? { name } : {}),
      ...(command === 'link-pr' ? { url } : {}) })}\n`);
    const response = JSON.parse(
      await readLine(socket, command === 'status' ? MAX_STATUS_RESPONSE_BYTES : MAX_FRAME_BYTES),
    ) as unknown;
    if (typeof response !== 'object' || response === null || !('id' in response) || response.id !== id ||
      !('generation' in response) || response.generation !== generation) {
      throw new Error('Supervised session changed since it was verified.');
    }
    return response;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    socket.destroy();
  }
}

export async function listSupervisedSessions(
  root = resolveSupervisedDirectory(),
  signal?: AbortSignal,
  options: { readonly cwd?: string; readonly name?: string; readonly pr?: number;
    readonly includeName?: boolean; readonly includeCwd?: boolean; readonly includePr?: boolean;
    readonly includeGeneration?: boolean } = {},
): Promise<readonly ISupervisedSessionRow[]> {
  signal?.throwIfAborted();
  try {
    verifyExistingDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = readdirSync(root).filter((name) => ID_PATTERN.test(name));
  if (names.length > MAX_ENTRIES) throw new Error('Too many supervised session records to list safely.');
  const unfiltered = options.cwd === undefined && options.name === undefined && options.pr === undefined;
  const rows = await Promise.all(names.map(async (id): Promise<ISupervisedSessionRow | null> => {
    signal?.throwIfAborted();
    const directory = sessionDirectory(root, id);
    let record: IRegistration;
    try {
      record = readRegistration(directory, id);
    } catch {
      try {
        lstatSync(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      }
      return unfiltered
        ? { id, liveness: 'unknown', control: 'unavailable', activity: 'unknown', problem: 'invalid-registration' }
        : null;
    }
    const currentStart = readProcessStartTime(record.pid);
    const liveness = currentStart === undefined
      ? probePid(record.pid) === 'absent' ? 'dead' : 'unknown'
      : currentStart === record.startedAt ? 'alive' : 'dead';
    // A registration without a generation cannot bind an action to its process start.
    if (liveness !== 'alive' || record.generation === undefined) return unfiltered
      ? { id, liveness, control: 'unavailable', activity: 'unknown' }
      : null;
    try {
      const response = await request(directory, id, record.generation, 'status', signal);
      if ('status' in response && response.status === 'running') {
        if (options.cwd !== undefined && (!('cwd' in response) || response.cwd !== options.cwd)) return null;
        const name = 'name' in response && isSupervisedSessionName(response.name) ? response.name : undefined;
        const pr = 'pr' in response && isSupervisedPr(response.pr) ? response.pr : undefined;
        const cwd = 'cwd' in response && typeof response.cwd === 'string' && isAbsolute(response.cwd) &&
          response.cwd.length <= 4_096 ? response.cwd : undefined;
        if (options.name !== undefined && !name?.toLowerCase().includes(options.name.toLowerCase())) return null;
        if (options.pr !== undefined && pr?.number !== options.pr) return null;
        return {
          id, liveness, control: 'available',
          activity: 'activity' in response && isCurrentActivity(response.activity) ? response.activity : 'unknown',
          ...(options.includeName && name !== undefined ? { name } : {}),
          ...(options.includeCwd && cwd !== undefined ? { cwd } : {}),
          ...(options.includePr && pr !== undefined ? { pr } : {}),
          ...(options.includeGeneration ? { generation: record.generation } : {}),
          ...('activity' in response && response.activity === 'idle' &&
            'nextLoopAt' in response && isLoopTime(response.nextLoopAt)
            ? { nextLoopAt: response.nextLoopAt } : {}),
        };
      }
    } catch {
      signal?.throwIfAborted();
      // A registered process can lose its control endpoint during shutdown.
    }
    return unfiltered ? { id, liveness, control: 'unavailable', activity: 'unknown' } : null;
  }));
  return rows.filter((row): row is ISupervisedSessionRow => row !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Stop the live owner. With `expectedGeneration` (the one a view displayed), a registration that has
 * changed since is refused instead of stopping whichever process now holds the id.
 */
export async function stopSupervisedSession(
  id: string,
  root = resolveSupervisedDirectory(),
  expectedGeneration?: string,
): Promise<void> {
  const { directory, record, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'stop');
  if (!('status' in response) || response.status !== 'stopping') {
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

export async function renameSupervisedSession(
  id: string,
  name: string,
  root = resolveSupervisedDirectory(),
  expectedGeneration?: string,
): Promise<void> {
  sessionDirectory(root, id);
  if (!isSupervisedSessionName(name)) throw new Error('Supervised session name is invalid or too long.');
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'rename', undefined, name);
  if (!('status' in response) || response.status !== 'renamed') {
    throw new Error('Supervised session did not confirm rename.');
  }
}

/**
 * Re-read the registration at action time instead of trusting a displayed row: its generation must
 * still be the expected one, and the registered process must still be the one that wrote it.
 */
function verifyLiveOwner(
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

export async function linkSupervisedPr(
  id: string,
  url: string,
  root = resolveSupervisedDirectory(),
  expectedGeneration?: string,
): Promise<void> {
  if (!parseSupervisedPr(url)) throw new Error('Invalid supervised session PR URL.');
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'link-pr', undefined, undefined, url);
  if (!('status' in response) || response.status !== 'linked') {
    throw new Error('Supervised session did not confirm PR link.');
  }
}

export async function unlinkSupervisedPr(
  id: string,
  root = resolveSupervisedDirectory(),
  expectedGeneration?: string,
): Promise<void> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'unlink-pr');
  if (!('status' in response) || response.status !== 'unlinked') {
    throw new Error('Supervised session did not confirm PR unlink.');
  }
}

/** Re-probe the selected owner immediately before a user-triggered open action. */
export async function getVerifiedSupervisedPr(
  id: string,
  root = resolveSupervisedDirectory(),
  expectedGeneration?: string,
): Promise<ISupervisedPr | undefined> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'status');
  if (!('status' in response) || response.status !== 'running') {
    throw new Error('Supervised session control response was not verified.');
  }
  if (!('pr' in response)) return undefined;
  if (!isSupervisedPr(response.pr)) throw new Error('Supervised session PR association was not verified.');
  return response.pr;
}

export interface ISupervisedControl {
  close(): Promise<void>;
}

export async function startSupervisedControl(
  id: string,
  onStop: () => void,
  root = resolveSupervisedDirectory(),
  getActivity?: () => Exclude<TSupervisedActivity, 'unknown'> | undefined,
  getCwd?: () => string | undefined,
  getNextLoopAt?: () => string | undefined,
  getName?: () => string | undefined,
  onRename?: (name: string) => void,
  pr?: { readonly get: () => ISupervisedPr | undefined; readonly set: (value: ISupervisedPr | undefined) => void },
  attachSession?: IProtocolSession,
): Promise<ISupervisedControl> {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid supervised session ID.');
  ensurePrivateDirectory(root);
  const directory = sessionDirectory(root, id);
  // A UUID directory is visible to list only after its registration is complete.
  const pendingDirectory = join(root, `.${id}.pending`);
  const socketPath = controlSocketPath(root, id);
  // One value per process start: a request bound to any other start is refused, never acted on.
  const generation = randomBytes(16).toString('base64url');
  const reply = (socket: Socket, body: Record<string, unknown>): void => {
    socket.end(`${JSON.stringify({ id, ...body, generation })}\n`);
  };
  // A caller that has not named this start learns nothing from the refusal: the generation is part
  // of the proof a later request presents, so it is echoed only to a caller that already holds it.
  const refuse = (socket: Socket, reason?: 'stale-generation'): void => {
    socket.end(`${JSON.stringify({ id, status: 'refused', ...(reason ? { reason } : {}) })}\n`);
  };
  const attach = attachSession === undefined ? undefined : createSupervisedAttachCarrier(attachSession);
  const clients = new Set<Socket>();
  const server: Server = createServer((socket) => {
    clients.add(socket);
    // readLine owns request errors only; write-side EPIPE can arrive after its listener is removed.
    socket.on('error', () => socket.destroy());
    socket.once('close', () => clients.delete(socket));
    let rest = '';
    void readLine(socket, MAX_FRAME_BYTES, (remaining) => { rest = remaining; }).then((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        refuse(socket);
        return;
      }
      if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== id || !('command' in value)) {
        refuse(socket);
        return;
      }
      if (!('generation' in value) || value.generation !== generation) {
        refuse(socket, 'stale-generation');
        return;
      }
      if (value.command === 'attach') {
        // Hold the next frames until the protocol takes over. This runs before any further data
        // event, so nothing sent after the handshake is dropped.
        socket.pause();
        // A refused handshake reads again, so the peer's close is seen and the socket is released.
        const refuse = (reason: string): void => {
          socket.resume();
          reply(socket, { status: 'refused', reason });
        };
        if (attach === undefined) {
          refuse('attach-unavailable');
          return;
        }
        void attach.admit(socket, value, rest, {
          refuse,
          accept: (driverId) => {
            socket.write(`${JSON.stringify({ id, status: 'attached', driverId, generation })}\n`);
          },
        }).catch(() => socket.destroy());
        return;
      }
      if (value.command === 'status') {
        let observed: unknown;
        let cwd: string | undefined;
        let nextLoopAt: unknown;
        let name: unknown;
        let linkedPr: unknown;
        try {
          observed = getActivity?.();
        } catch {
          // A failed observation cannot turn a verified control endpoint into a false activity claim.
        }
        try {
          cwd = getCwd?.();
        } catch {
          // A directory that cannot be verified is omitted, never guessed from registration data.
        }
        if (observed === 'idle') {
          try {
            nextLoopAt = getNextLoopAt?.();
          } catch {
            // A failed loop observation cannot turn an idle session into a false wake claim.
          }
        }
        try {
          name = getName?.();
        } catch {
          // A failed name observation does not change the session's verified activity.
        }
        try {
          linkedPr = pr?.get();
        } catch {
          // A failed association observation cannot create a link.
        }
        reply(socket, { status: 'running', activity: isCurrentActivity(observed) ? observed : 'unknown',
          ...(typeof cwd === 'string' && isAbsolute(cwd) && cwd.length <= 4_096 ? { cwd } : {}),
          ...(isLoopTime(nextLoopAt) ? { nextLoopAt } : {}),
          ...(isSupervisedSessionName(name) ? { name } : {}),
          ...(isSupervisedPr(linkedPr) ? { pr: linkedPr } : {}) });
      } else if (value.command === 'stop') {
        socket.once('finish', onStop);
        reply(socket, { status: 'stopping' });
      } else if (value.command === 'rename' && 'name' in value &&
        isSupervisedSessionName(value.name) && onRename !== undefined) {
        try {
          onRename(value.name);
          reply(socket, { status: 'renamed' });
        } catch {
          reply(socket, { status: 'refused' });
        }
      } else if (value.command === 'link-pr' && 'url' in value && pr?.set !== undefined) {
        const linked = parseSupervisedPr(value.url);
        if (!linked) {
          reply(socket, { status: 'refused' });
          return;
        }
        try {
          pr.set(linked);
          reply(socket, { status: 'linked' });
        } catch {
          reply(socket, { status: 'refused' });
        }
      } else if (value.command === 'unlink-pr' && pr?.set !== undefined) {
        try {
          pr.set(undefined);
          reply(socket, { status: 'unlinked' });
        } catch {
          reply(socket, { status: 'refused' });
        }
      } else {
        reply(socket, { status: 'refused' });
      }
    }).catch(() => socket.destroy());
  });
  let bound = false;
  try {
    mkdirSync(pendingDirectory, { mode: 0o700 });
    verifyExistingDirectory(pendingDirectory);
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
      generation,
    };
    writeFileSync(join(pendingDirectory, 'state.json'), JSON.stringify(registration), { flag: 'wx', mode: 0o600 });
    try {
      lstatSync(directory);
      throw new Error('Supervised session ID is already registered.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    renameSync(pendingDirectory, directory);
  } catch (error) {
    if (bound) server.close();
    if (bound) rmSync(socketPath, { force: true });
    rmSync(pendingDirectory, { recursive: true, force: true });
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
