import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstatSync, mkdirSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';

import { isLinkRequest } from '@robota-sdk/agent-transport-link';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';
import type { IRuntimeAdmission, TRuntimeAdmissionFactory } from './runtime-admission.js';
import type {
  IExternalEventGrantCounters,
  IExternalEventGrantRow,
} from '../external-events/external-event-grant-host.js';

import {
  parseExternalEventGrant,
  toExternalEventGrantDocument,
} from '../external-events/external-event-grant-file.js';

import { resolveRendezvousDirectory } from '../remote-control/local-peer-rendezvous.js';
import {
  CONTROL_ACCESS,
  isControlCommandName,
  type TControlCommandName,
} from './control-access.js';
import { createSupervisedAttachCarrier, type TSupervisedAttachTarget } from './supervised-attach.js';
import { MAX_CONTROL_FRAME_BYTES, SUPERVISED_ID_PATTERN, WindowsControlPipeServer, connectControlSocket, controlSocketPath, createWindowsPrivateDirectory, ensurePrivateDirectory, listRegisteredCandidates, probeRegisteredPid as probePid, readRegisteredProcessStartTime as readProcessStartTime, readOwnedFile, sessionDirectory, verifyExistingDirectory, verifyLiveOwner, type IControlChannel, type IRegistration } from '@robota-sdk/agent-local-host';


const MAX_FRAME_BYTES = MAX_CONTROL_FRAME_BYTES;
const MAX_STATUS_RESPONSE_BYTES = 32_768;
const REQUEST_TIMEOUT_MS = 2_000;
const MAX_NAME_BYTES = 240;
const MAX_PR_URL_BYTES = 2_048;
const NAME_CONTROLS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;


/** The commands a client of the plain socket sends one request line for. */
type TControlCommand = Extract<
  TControlCommandName,
  'status' | 'stop' | 'lock' | 'rename' | 'link-pr' | 'unlink-pr' | 'events-list' | 'events-revoke' | 'connect'
>;

const GRANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/u;
const MAX_GRANT_HANDOFF_BYTES = 256 * 1024;
const MAX_LISTED_GRANTS = 64;
const REFUSALS: ReadonlySet<string> = new Set([
  'oversize', 'malformed', 'wrong-type', 'unsupported-algorithm', 'ambiguous-key', 'unknown-key',
  'key-mismatch', 'bad-signature', 'wrong-issuer', 'wrong-audience', 'expired', 'not-yet-valid',
  'missing-scope', 'principal-not-allowed', 'keys-unavailable', 'missing-token', 'unknown-grant',
  'grant-revoked', 'source-closed', 'malformed-event', 'rate-limited', 'queue-full', 'shutting-down',
  'session-unavailable',
]);
const SETTLEMENTS: ReadonlySet<string> = new Set(['completed', 'interrupted', 'not-run', 'failed']);

/** A grant as a session listing shows it: label, state and counts, never the principal. */
export type TSupervisedGrantSummary = Omit<IExternalEventGrantRow, 'principal'>;

function isCountMap(value: unknown, keys: ReadonlySet<string>): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([key, count]) =>
      keys.has(key) && Number.isSafeInteger(count) && Number(count) >= 0);
}

function readGrantCounters(value: unknown): IExternalEventGrantCounters | undefined {
  if (typeof value !== 'object' || value === null || !('accepted' in value) || !('refused' in value) ||
    !('settled' in value) || !Number.isSafeInteger(value.accepted) || Number(value.accepted) < 0 ||
    !isCountMap(value.refused, REFUSALS) || !isCountMap(value.settled, SETTLEMENTS)) return undefined;
  return {
    accepted: Number(value.accepted),
    refused: { ...value.refused },
    settled: { ...value.settled },
  };
}

/** Rebuild a grant summary from exactly the fields it may carry, so nothing else is echoed. */
function readGrantSummary(value: unknown): TSupervisedGrantSummary | undefined {
  if (typeof value !== 'object' || value === null || !('grantId' in value) || !('state' in value) ||
    typeof value.grantId !== 'string' || !GRANT_ID_PATTERN.test(value.grantId) ||
    (value.state !== 'open' && value.state !== 'revoked') || !('counters' in value)) return undefined;
  const counters = readGrantCounters(value.counters);
  return counters === undefined ? undefined : { grantId: value.grantId, state: value.state, counters };
}

function readGrantRow(value: unknown): IExternalEventGrantRow | undefined {
  const summary = readGrantSummary(value);
  if (summary === undefined || typeof value !== 'object' || value === null || !('principal' in value) ||
    (value.principal !== 'subject' && value.principal !== 'client')) return undefined;
  return { grantId: summary.grantId, principal: value.principal, state: summary.state, counters: summary.counters };
}

function readList<T>(value: unknown, read: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LISTED_GRANTS) return undefined;
  const items = value.map(read);
  return items.every((item) => item !== undefined) ? (items as T[]) : undefined;
}


type TSupervisedActivity = 'working' | 'needs-input' | 'idle' | 'unknown';

function isCurrentActivity(value: unknown): value is Exclude<TSupervisedActivity, 'unknown'> {
  return value === 'working' || value === 'needs-input' || value === 'idle';
}

const MAX_DAEMON_URL_BYTES = 2_048;

/** A daemon's own loopback WebSocket URL, and nothing else, is handed to its owner. */
function isDaemonUrl(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DAEMON_URL_BYTES ||
    /[\p{Cc}\p{Cf}\s]/u.test(value)) return false;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  return parsed.protocol === 'ws:' && parsed.hostname === '127.0.0.1' && parsed.port !== '' &&
    !parsed.username && !parsed.password && !parsed.hash;
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
  /** Present only when requested: the live owner reports itself as its workspace's daemon. */
  readonly daemon?: true;
  /** Present only with `daemon`: the daemon runs Restricted, without the project's own configuration. */
  readonly restricted?: true;
  /** Present only when requested and verified: the registration this row's actions must still address. */
  readonly generation?: string;
  /** Present when requested and the endpoint reports secure custody. */
  readonly secure?: { readonly certified: boolean };
  /** Present only when requested: each external-event grant's label, state and counts. */
  readonly externalEvents?: readonly TSupervisedGrantSummary[];
  readonly problem?: 'invalid-registration';
}


/** A Linux zombie has exited even when its parent has not yet reaped its PID. */
function isRegisteredLinuxZombie(pid: number, startedAt: string): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (!stat.startsWith(`${pid} (`) || close < 0) return false;
    // The command name may contain spaces and parentheses; field 3 starts after its last ')'.
    const fields = stat.slice(close + 1).trim().split(/\s+/u);
    return fields[0] === 'Z' && fields[19] === startedAt;
  } catch {
    // An unreadable process is not evidence that it exited.
    return false;
  }
}

export function resolveSupervisedDirectory(productRuntime: ICliRuntimeContext): string {
  return join(dirname(resolveRendezvousDirectory(productRuntime)), 'supervised');
}

/** `onRest` receives whatever arrived after the line, for a connection that stays open. */
function readLine(
  socket: IControlChannel,
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
 * The first line a connection sends, as bytes, and whatever arrived with it, with the socket paused
 * again. It is bytes because the owner link's handshake follows its request line in the same chunk,
 * and a text decoder would rewrite what is not valid text, which a handshake mostly is. The bound
 * and the deadline are the ones every request has.
 */
function readRequestLine(socket: IControlChannel): Promise<{ readonly line: string; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    let done = false;
    const timer = setTimeout(
      () => finish(() => reject(new Error('Supervised session control timed out.'))),
      REQUEST_TIMEOUT_MS,
    );
    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
      socket.pause();
      action();
    };
    const onData = (chunk: Buffer | string): void => {
      received = Buffer.concat([received, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk]);
      const end = received.indexOf(0x0a);
      // The bound is on the line itself: what follows it belongs to the protocol that line opens.
      if ((end === -1 ? received.length : end) > MAX_FRAME_BYTES) {
        finish(() => reject(new Error('Supervised session control frame is too large.')));
        return;
      }
      if (end !== -1) {
        finish(() =>
          resolve({
            line: received.subarray(0, end).toString('utf8'),
            rest: Buffer.from(received.subarray(end + 1)),
          }),
        );
      }
    };
    const onError = (): void => finish(() => reject(new Error('Supervised session control is unavailable.')));
    const onEnd = (): void => finish(() => reject(new Error('Supervised session control closed before replying.')));
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

/**
 * Send one command bound to `generation`. A reply is returned only when its owner echoes that same
 * generation, so a reply from a different process start is never taken as this registration's.
 */
/** Open the owner's control socket, refusing one this user does not own. */

async function request(
  directory: string,
  id: string,
  generation: string,
  command: TControlCommand,
  signal?: AbortSignal,
  name?: string,
  url?: string,
  grantId?: string,
): Promise<object> {
  signal?.throwIfAborted();
  const socket = await connectControlSocket(directory, id, signal);
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
      ...(command === 'link-pr' ? { url } : {}),
      ...(command === 'events-revoke' ? { grantId } : {}) })}\n`);
    const response = JSON.parse(
      await readLine(socket, command === 'status' || command === 'events-list'
        ? MAX_STATUS_RESPONSE_BYTES : MAX_FRAME_BYTES),
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

function optionalGrants(
  grants: TSupervisedGrantSummary[] | undefined,
): { readonly externalEvents?: readonly TSupervisedGrantSummary[] } {
  return grants === undefined ? {} : { externalEvents: grants };
}

export async function listSupervisedSessions(
  root: string,
  signal?: AbortSignal,
  options: { readonly cwd?: string; readonly name?: string; readonly pr?: number;
    readonly includeName?: boolean; readonly includeCwd?: boolean; readonly includePr?: boolean;
    readonly includeGeneration?: boolean; readonly includeExternalEvents?: boolean;
    readonly includeDaemon?: boolean; readonly includeSecure?: boolean } = {},
): Promise<readonly ISupervisedSessionRow[]> {
  signal?.throwIfAborted();
  const candidates = await listRegisteredCandidates(root, signal);
  const unfiltered = options.cwd === undefined && options.name === undefined && options.pr === undefined;
  const rows = await Promise.all(candidates.map(async (candidate): Promise<ISupervisedSessionRow | null> => {
    signal?.throwIfAborted();
    const { id, liveness, generation } = candidate;
    if (liveness !== 'alive' || generation === undefined) return unfiltered
      ? { id, liveness, control: 'unavailable', activity: 'unknown',
          ...(candidate.problem ? { problem: candidate.problem } : {}) }
      : null;
    try {
      const { directory } = verifyLiveOwner(root, id, generation);
      const response = await request(directory, id, generation, 'status', signal);
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
          ...(options.includeGeneration ? { generation } : {}),
          ...(options.includeSecure && 'certified' in response && typeof response.certified === 'boolean'
            ? { secure: { certified: response.certified } } : {}),
          ...(options.includeDaemon && 'daemon' in response && response.daemon === true
            ? { daemon: true as const,
                ...('restricted' in response && response.restricted === true ? { restricted: true as const } : {}) }
            : {}),
          ...(options.includeExternalEvents && 'externalEvents' in response
            ? optionalGrants(readList(response.externalEvents, readGrantSummary)) : {}),
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

/** Lock one registered secure runtime without opening an owner link. */
export async function lockSupervisedSession(id: string, root: string, expectedGeneration: string): Promise<void> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'lock');
  if (!('status' in response) || response.status !== 'locked') {
    throw new Error('Supervised session did not confirm locking.');
  }
}

/**
 * Stop the live owner. With `expectedGeneration` (the one a view displayed), a registration that has
 * changed since is refused instead of stopping whichever process now holds the id.
 */
export async function stopSupervisedSession(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<void> {
  const { directory, record, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'stop');
  if (!('status' in response) || response.status !== 'stopping') {
    throw new Error('Supervised session did not confirm shutdown.');
  }
  await awaitRuntimeExit(directory, record);
}

/**
 * End a runtime this process started and return only once it is gone. A runtime whose spawner
 * left without certifying it ends itself, and its control closes before it answers a stop request:
 * that is a runtime on its way out, not one that has left, and a caller that goes on while it is
 * still registered sees it as a live session with no control. So an unanswered or refused stop is
 * not an error here, and the wait for the exit does not depend on the answer.
 */
export async function stopStartedSupervisedSession(
  id: string,
  root: string,
  expectedGeneration: string,
): Promise<void> {
  const { directory, record, generation } = verifyLiveOwner(root, id, expectedGeneration);
  try {
    await request(directory, id, generation, 'stop');
  } catch {
    // allow-fallback: the runtime may already be stopping itself; the wait below decides.
  }
  await awaitRuntimeExit(directory, record);
}

/** Resolves once the registration is removed and the registered process has exited. */
export async function awaitRuntimeExit(directory: string, record: Pick<IRegistration, 'pid' | 'startedAt'>): Promise<void> {
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
      : startedAt !== record.startedAt ||
        (registrationRemoved && isRegisteredLinuxZombie(record.pid, record.startedAt));
    if (registrationRemoved && originalProcessExited) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Supervised session accepted stop but did not finish shutdown.');
}

export async function renameSupervisedSession(
  id: string,
  name: string,
  root: string,
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

export async function linkSupervisedPr(
  id: string,
  url: string,
  root: string,
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
  root: string,
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
  root: string,
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

/**
 * The WebSocket URL, token included, of a live daemon this user owns. Like every control action it
 * is bound to the start the caller verified; a session that is not a daemon refuses.
 */
export async function connectSupervisedDaemon(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<string> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'connect');
  if (!('status' in response) || response.status !== 'connected' || !('url' in response) ||
    !isDaemonUrl(response.url)) {
    throw new Error('Supervised session did not hand over a daemon connection.');
  }
  return response.url;
}

const ATTACH_REFUSALS: Readonly<Record<string, string>> = {
  'stale-generation': 'Supervised session changed since it was listed.',
  'attach-limit': 'Too many terminals are already attached to this supervised session.',
  'attach-unavailable': 'This supervised session does not accept attached terminals.',
  'unsupported-attach': 'This supervised session does not support this kind of attach.',
  declined: 'This supervised session declined the attach.',
};

export interface ISupervisedAttachSocket {
  readonly socket: IControlChannel;
  readonly driverId: string;
  /** Protocol bytes that arrived with the handshake reply. The socket is paused. */
  readonly rest: string;
}

/**
 * Attach to a live owner. The registration is re-read here, not trusted from a listed row: with
 * `expectedGeneration` (the one the user confirmed) a restart since then is refused, and the owner
 * compares the same generation again before admitting the connection.
 */
export async function openSupervisedAttachSocket(
  id: string,
  mode: 'drive' | 'observe',
  root: string,
  expectedGeneration?: string,
): Promise<ISupervisedAttachSocket> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const socket = await connectControlSocket(directory, id);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', () => reject(new Error('Supervised session control is unavailable.')));
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => reject(new Error('Supervised session control timed out.')));
    });
    socket.write(`${JSON.stringify({ command: 'attach', id, generation, mode, protocol: 1 })}\n`);
    let rest = '';
    // Paused until the caller reads the protocol, so no frame is dropped in between.
    const reply = JSON.parse(await readLine(socket, MAX_FRAME_BYTES, (remaining) => {
      rest = remaining;
      socket.pause();
    })) as unknown;
    if (typeof reply !== 'object' || reply === null || !('id' in reply) || reply.id !== id) {
      throw new Error('Supervised session did not confirm the attach.');
    }
    if ('status' in reply && reply.status === 'refused') {
      const reason = 'reason' in reply && typeof reply.reason === 'string' ? ATTACH_REFUSALS[reply.reason] : undefined;
      throw new Error(reason ?? 'Supervised session refused the attach.');
    }
    if (!('status' in reply) || reply.status !== 'attached' || !('generation' in reply) ||
      reply.generation !== generation || !('driverId' in reply) || typeof reply.driverId !== 'string' ||
      !/^attach:[1-9][0-9]*$/u.test(reply.driverId)) {
      throw new Error('Supervised session did not confirm the attach.');
    }
    socket.setTimeout(0);
    return { socket, driverId: reply.driverId, rest };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/** The owner's grants on a live session: labels, principal kinds, states and counts. */
export async function listSupervisedExternalEvents(
  id: string,
  root: string,
  expectedGeneration?: string,
): Promise<readonly IExternalEventGrantRow[]> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(directory, id, generation, 'events-list');
  const grants = 'status' in response && response.status === 'events' && 'grants' in response
    ? readList(response.grants, readGrantRow) : undefined;
  if (grants === undefined) throw new Error('Supervised session did not list its external event grants.');
  return grants;
}

/** Withdraw one grant from a live session; later events for it are refused as revoked. */
export async function revokeSupervisedExternalEventGrant(
  id: string,
  grantId: string,
  root: string,
  expectedGeneration?: string,
): Promise<void> {
  if (!GRANT_ID_PATTERN.test(grantId)) throw new Error('Invalid external event grant label.');
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await request(
    directory, id, generation, 'events-revoke', undefined, undefined, undefined, grantId,
  );
  if ('status' in response && response.status === 'revoked') return;
  if ('reason' in response && response.reason === 'unknown-grant') {
    throw new Error(`Supervised session holds no external event grant ${grantId}.`);
  }
  throw new Error('Supervised session did not confirm the revocation.');
}

/** The owner-only directory a supervised session's external-event audit trail is written to. */
export function ensureSupervisedAuditDirectory(root: string): string {
  ensurePrivateDirectory(root);
  const directory = join(root, 'audit');
  ensurePrivateDirectory(directory);
  return directory;
}

function daemonStartLockFile(workspace: string, root: string): string {
  const digest = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
  return join(root, `.daemon-${digest}.lock`);
}

/**
 * Who holds a daemon start lock: a live process, one that is gone, or nobody the file names.
 * `undefined` means the lock was released in the meantime.
 */
function readDaemonStartLockOwner(
  file: string,
): { readonly pid?: number; readonly state: 'live' | 'gone' | 'unknown' } | undefined {
  let content: string;
  try {
    content = readOwnedFile(file, {
      ownerOnly: false, refusal: 'Daemon start lock is not owned by this user.',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  // `<pid> <start time>`: a pid alone could name an unrelated process that reused it after the
  // owner died, which would keep the lock looking held for good.
  const match = /^([1-9][0-9]{0,9}) (\S.*)$/u.exec(content);
  if (match === null) return { state: 'unknown' };
  const pid = Number(match[1]);
  if (probePid(pid) === 'absent') return { pid, state: 'gone' };
  return { pid, state: readProcessStartTime(pid) === match[2] ? 'live' : 'gone' };
}

const unlockHint = (cliName: string): string => `If no daemon start is running, remove it with: ${cliName} daemon clear-start-lock`;

/**
 * Serialize `the CLI daemon start` in one workspace, so two starts never launch two daemons. The lock
 * is a file created exclusively in the private supervised directory, holding its owner's pid. A live
 * owner is waited for. A lock this start did not take is never removed here: one left by a start
 * that is gone refuses the start and names `the CLI daemon clear-start-lock`, so removing it is the user's call.
 * Resolves to the release of this start's own lock.
 */
export async function acquireSupervisedDaemonStartLock(
  workspace: string,
  root: string,
  options: { readonly cliName: string; readonly timeoutMs?: number; readonly pollMs?: number },
): Promise<() => void> {
  ensurePrivateDirectory(root);
  const file = daemonStartLockFile(workspace, root);
  const startedAt = readProcessStartTime(process.pid);
  if (!startedAt) throw new Error('Unable to prove the daemon start process identity.');
  const owner = `${process.pid} ${startedAt}`;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    try {
      writeFileSync(file, owner, { flag: 'wx', mode: 0o600 });
      return () => {
        try {
          if (readFileSync(file, 'utf8') === owner) rmSync(file, { force: true });
        } catch {
          // Already gone; nothing to release.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const holder = readDaemonStartLockOwner(file);
    if (holder?.state === 'gone') {
      throw new Error(
        `A daemon start lock left by process ${holder.pid}, which is no longer running, remains at ${file}. ${unlockHint(options.cliName)}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Another daemon start is still running in ${workspace}, or its lock remains at ${file}. ${unlockHint(options.cliName)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
  }
}

/**
 * `the CLI daemon clear-start-lock`: remove this workspace's daemon start lock at the user's request. A lock whose
 * owner is still running is kept, since that start is still in progress.
 */
export function removeSupervisedDaemonStartLock(
  workspace: string,
  root: string,
): { readonly outcome: 'removed' | 'none' } | { readonly outcome: 'held'; readonly pid: number } {
  try {
    verifyExistingDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { outcome: 'none' };
    throw error;
  }
  const file = daemonStartLockFile(workspace, root);
  const holder = readDaemonStartLockOwner(file);
  if (holder === undefined) return { outcome: 'none' };
  if (holder.state === 'live' && holder.pid !== undefined) return { outcome: 'held', pid: holder.pid };
  rmSync(file, { force: true });
  return { outcome: 'removed' };
}

function grantHandoffPath(root: string, id: string): string {
  sessionDirectory(root, id);
  return join(root, `.${id}.grants.json`);
}

/**
 * Hand a starting child its exact grants through a private file: not argv, which other local users
 * can read, and not the control socket. The file holds public configuration only.
 */
export function writeSupervisedGrantHandoff(
  root: string,
  id: string,
  grants: readonly IExternalEventGrant[],
): void {
  ensurePrivateDirectory(root);
  writeFileSync(grantHandoffPath(root, id), JSON.stringify(grants.map(toExternalEventGrantDocument)),
    { flag: 'wx', mode: 0o600 });
}

export function discardSupervisedGrantHandoff(root: string, id: string): void {
  rmSync(grantHandoffPath(root, id), { force: true });
}

/** Read and delete the handoff, re-validating every grant; a refused or missing file refuses the start. */
export function takeSupervisedGrantHandoff(root: string, id: string): IExternalEventGrant[] {
  const file = grantHandoffPath(root, id);
  let documents: unknown;
  try {
    verifyExistingDirectory(root);
    documents = JSON.parse(readOwnedFile(file, {
      ownerOnly: true, maxBytes: MAX_GRANT_HANDOFF_BYTES, refusal: 'refused',
    })) as unknown;
  } catch {
    throw new Error('Supervised external event grants could not be read.');
  } finally {
    rmSync(file, { force: true });
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error('Supervised external event grants could not be read.');
  }
  return documents.map((document, index) => parseExternalEventGrant(document, index + 1));
}

/** What the supervised process exposes about its external-event grants over the control socket. */
export interface ISupervisedExternalEvents {
  list(): readonly IExternalEventGrantRow[];
  revoke(grantId: string): 'revoked' | 'unknown-grant';
}

/** A daemon's control hands its owner the URL its transport is served on. */
export interface ISupervisedDaemon {
  /** `undefined` until the transport is bound, or once the runtime is stopping. */
  url(): string | undefined;
  /** It runs Restricted, so a start that needs the project's configuration does not reuse it. */
  readonly restricted?: boolean;
}

export interface ISupervisedControl {
  close(): Promise<void>;
}

/** What a control endpoint observes of its runtime; whatever is left out is not reported. */
export interface IControlObservation {
  readonly activity?: (() => Exclude<TSupervisedActivity, 'unknown'> | undefined) | undefined;
  readonly cwd?: (() => string | undefined) | undefined;
  readonly nextLoopAt?: (() => string | undefined) | undefined;
  readonly name?: (() => string | undefined) | undefined;
}

export interface ISupervisedControlOptions {
  /** The runtime's supervised id, the name of its registration and socket. */
  readonly id: string;
  /** The private directory the registration and socket live in. */
  readonly root: string;
  /** Called after a stop request has been answered. */
  readonly onStop: () => void;
  readonly observe?: IControlObservation | undefined;
  readonly rename?: ((name: string) => void) | undefined;
  readonly pr?:
    | {
        readonly get: () => ISupervisedPr | undefined;
        readonly set: (value: ISupervisedPr | undefined) => void;
      }
    | undefined;
  readonly externalEvents?: ISupervisedExternalEvents | undefined;
  readonly attachTarget?: TSupervisedAttachTarget | undefined;
  readonly daemon?: ISupervisedDaemon | undefined;
  /**
   * Makes this a secure runtime's endpoint: the commands a same-user program may send shrink to
   * what `CONTROL_ACCESS` leaves open in secure mode, the rest is the owner's through an owner link
   * the custody serves, and `status` reports what the custody says. Absent, every command is open
   * as it always was.
   */
  readonly admission?: TRuntimeAdmissionFactory | undefined;
}

/**
 * Who a command's answer is for: `plain` is a plain runtime's socket (everything, as always), `open`
 * is a secure runtime's socket (what a program of this user may learn), `owner` is an admitted
 * owner's `control` request (what the owner may learn).
 */
type TControlView = 'plain' | 'open' | 'owner';

/** What one command answers, and what must happen once the answer has been written. */
interface IControlOutcome {
  readonly body: Record<string, unknown>;
  readonly afterReply?: () => void;
}

/**
 * One request's fields as a command reads them: the plain socket's request line, or the fields of an
 * owner link's `control` request.
 */
type TControlRequest = Readonly<Record<string, unknown>>;

/**
 * Every command that answers from the runtime's own state, in one place, so the plain socket and an
 * owner link's `control` request give the same answers. A command whose handler the runtime did not
 * supply answers `refused`, as does one that is not an answer from state (attach, lock, link).
 */
function createControlHandler(
  options: ISupervisedControlOptions,
  admissionOf: () => IRuntimeAdmission | undefined,
): (command: TControlCommandName, request: TControlRequest, view: TControlView) => IControlOutcome {
  const { observe, rename, pr, externalEvents, daemon } = options;
  const refused: IControlOutcome = { body: { status: 'refused' } };
  const status = (view: TControlView): IControlOutcome => {
    const custody = admissionOf()?.status();
    // What names the work stays out of a secure runtime's open answer, and is not even read for it.
    const named = view !== 'open';
    let observed: unknown;
    let cwd: string | undefined;
    let nextLoopAt: unknown;
    let name: unknown;
    let linkedPr: unknown;
    try {
      observed = observe?.activity?.();
    } catch {
      // A failed observation cannot turn a verified control endpoint into a false activity claim.
    }
    try {
      cwd = observe?.cwd?.();
    } catch {
      // A directory that cannot be verified is omitted, never guessed from registration data.
    }
    if (observed === 'idle') {
      try {
        nextLoopAt = observe?.nextLoopAt?.();
      } catch {
        // A failed loop observation cannot turn an idle session into a false wake claim.
      }
    }
    try {
      if (named) name = observe?.name?.();
    } catch {
      // A failed name observation does not change the session's verified activity.
    }
    try {
      if (named) linkedPr = pr?.get();
    } catch {
      // A failed association observation cannot create a link.
    }
    let grants: TSupervisedGrantSummary[] | undefined;
    try {
      if (named) {
        grants = externalEvents?.list().map(({ grantId, state, counters }) => ({ grantId, state, counters }));
      }
    } catch {
      // Counts that cannot be read are omitted, never guessed.
    }
    return {
      body: {
        status: 'running',
        activity: isCurrentActivity(observed) ? observed : 'unknown',
        ...(typeof cwd === 'string' && isAbsolute(cwd) && cwd.length <= 4_096 ? { cwd } : {}),
        ...(isLoopTime(nextLoopAt) ? { nextLoopAt } : {}),
        ...(isSupervisedSessionName(name) ? { name } : {}),
        ...(isSupervisedPr(linkedPr) ? { pr: linkedPr } : {}),
        ...(grants !== undefined && grants.length > 0 ? { externalEvents: grants } : {}),
        ...(custody === undefined
          ? daemon !== undefined
            ? { daemon: true, ...(daemon.restricted === true ? { restricted: true } : {}) }
            : {}
          : {
              ...(custody.daemon
                ? { daemon: true, ...(custody.restricted ? { restricted: true } : {}) }
                : {}),
              certified: custody.certified,
            }),
      },
    };
  };
  return (command, request, view) => {
    switch (command) {
      case 'status':
        return status(view);
      case 'lock': {
        const admission = admissionOf();
        if (admission === undefined) return refused;
        admission.lock();
        return { body: { status: 'locked' } };
      }
      case 'take-daemon-role':
        return admissionOf()?.takeDaemonRole() === true ? { body: { status: 'daemon' } } : refused;
      case 'connect': {
        if (daemon === undefined || admissionOf() !== undefined) return refused;
        let url: unknown;
        try {
          url = daemon.url();
        } catch {
          // A URL that cannot be read is never guessed.
        }
        return isDaemonUrl(url) ? { body: { status: 'connected', url } } : refused;
      }
      case 'stop':
        return { body: { status: 'stopping' }, afterReply: options.onStop };
      case 'rename': {
        const name = request['name'];
        if (!isSupervisedSessionName(name) || rename === undefined) return refused;
        try {
          rename(name);
          return { body: { status: 'renamed' } };
        } catch {
          return refused;
        }
      }
      case 'link-pr': {
        if (!('url' in request) || pr?.set === undefined) return refused;
        const linked = parseSupervisedPr(request['url']);
        if (!linked) return refused;
        try {
          pr.set(linked);
          return { body: { status: 'linked' } };
        } catch {
          return refused;
        }
      }
      case 'events-list': {
        if (externalEvents === undefined) return refused;
        try {
          return { body: { status: 'events', grants: externalEvents.list() } };
        } catch {
          return refused;
        }
      }
      case 'events-revoke': {
        const grantId = request['grantId'];
        if (externalEvents === undefined || typeof grantId !== 'string' || !GRANT_ID_PATTERN.test(grantId)) {
          return refused;
        }
        try {
          return {
            body: externalEvents.revoke(grantId) === 'revoked'
              ? { status: 'revoked' }
              : { status: 'refused', reason: 'unknown-grant' },
          };
        } catch {
          return refused;
        }
      }
      case 'unlink-pr': {
        if (pr?.set === undefined) return refused;
        try {
          pr.set(undefined);
          return { body: { status: 'unlinked' } };
        } catch {
          return refused;
        }
      }
      default:
        // `attach` needs its socket, and `link` is not an answer from state at all.
        return refused;
    }
  };
}

export async function startSupervisedControl(options: ISupervisedControlOptions): Promise<ISupervisedControl> {
  const { id, root, attachTarget } = options;
  if (!SUPERVISED_ID_PATTERN.test(id)) throw new Error('Invalid supervised session ID.');
  ensurePrivateDirectory(root);
  const directory = sessionDirectory(root, id);
  // A UUID directory is visible to list only after its registration is complete.
  const pendingDirectory = join(root, `.${id}.pending`);
  const socketPath = controlSocketPath(root, id);
  // One value per process start: a request bound to any other start is refused, never acted on.
  const generation = randomBytes(16).toString('base64url');
  // The request reader leaves a socket paused, so that an owner link or an attach can take it over
  // with nothing lost. Every answer that ends the connection reads again first: a paused socket with
  // bytes behind its request line never sees its peer close, and would hold its descriptors for good.
  const reply = (socket: IControlChannel, body: Record<string, unknown>): void => {
    socket.resume();
    socket.end(`${JSON.stringify({ id, ...body, generation })}\n`);
  };
  // A caller that has not named this start learns nothing from the refusal: the generation is part
  // of the proof a later request presents, so it is echoed only to a caller that already holds it.
  const refuse = (socket: IControlChannel, reason?: 'stale-generation'): void => {
    socket.resume();
    socket.end(`${JSON.stringify({ id, status: 'refused', ...(reason ? { reason } : {}) })}\n`);
  };
  const attach = attachTarget === undefined
    ? undefined
    : createSupervisedAttachCarrier(attachTarget);
  let admission: IRuntimeAdmission | undefined;
  const handle = createControlHandler(options, () => admission);
  admission = options.admission?.({
    binding: { runtimeId: id, generation },
    control: (command, fields) => {
      // Only what an owner may send, plus the whole status that the open one trims.
      if (!isControlCommandName(command)) return { status: 'refused' };
      if (CONTROL_ACCESS[command].secure !== 'owner-control' && command !== 'status') {
        return { status: 'refused' };
      }
      return handle(command, fields, 'owner').body;
    },
  });
  const clients = new Set<IControlChannel>();
  const onConnection = (socket: IControlChannel): void => {
    clients.add(socket);
    // readLine owns request errors only; write-side EPIPE can arrive after its listener is removed.
    socket.on('error', () => socket.destroy());
    socket.once('close', () => clients.delete(socket));
    void readRequestLine(socket).then(({ line, rest }) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        refuse(socket);
        return;
      }
      // An owner link names no runtime and no start; the handshake that follows proves both.
      if (isLinkRequest(value)) {
        if (admission === undefined) refuse(socket);
        else admission.serveLink(socket, rest);
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
      const command = value.command;
      const access =
        isControlCommandName(command)
          ? admission === undefined
            ? CONTROL_ACCESS[command].plain
            : CONTROL_ACCESS[command].secure
          : 'absent';
      // `owner-control` commands are the owner's, and reach the runtime only inside an owner link.
      if (!isControlCommandName(command) || access === 'absent' || access === 'owner-control') {
        reply(socket, { status: 'refused' });
        return;
      }
      if (command === 'attach') {
        // The protocol that follows is text: what arrived with the request line goes back in front of
        // the stream, which decodes it from here on, and the socket stays paused until the carrier
        // takes over, so nothing sent after the handshake is dropped.
        if (rest.length > 0) socket.unshift(rest);
        socket.setEncoding('utf8');
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
        void attach.admit(socket, value, '', {
          refuse,
          accept: (driverId) => {
            socket.write(`${JSON.stringify({ id, status: 'attached', driverId, generation })}\n`);
          },
        }).catch(() => socket.destroy());
        return;
      }
      const outcome = handle(command, value as TControlRequest, admission === undefined ? 'plain' : 'open');
      if (outcome.afterReply !== undefined) socket.once('finish', outcome.afterReply);
      reply(socket, outcome.body);
    }).catch(() => socket.destroy());
  };
  const server = process.platform === 'win32' ? new WindowsControlPipeServer(onConnection) : createServer(onConnection);
  let bound = false;
  try {
    if (process.platform === 'win32') createWindowsPrivateDirectory(pendingDirectory, true);
    else mkdirSync(pendingDirectory, { mode: 0o700 });
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
    if (bound && process.platform !== 'win32') rmSync(socketPath, { force: true });
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
      if (process.platform !== 'win32') rmSync(socketPath, { force: true });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
