import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { listRegisteredCandidates } from './registered-candidates.js';
import {
  MAX_CONTROL_FRAME_BYTES, connectControlSocket, probeRegisteredPid as probePid,
  readRegisteredProcessStartTime as readProcessStartTime, verifyLiveOwner,
  type IRegistration,
} from './supervised-control-carrier.js';

import type { TControlCommandName } from './control-access.js';
import type { IControlChannel } from './windows-control-pipe.js';

const MAX_STATUS_RESPONSE_BYTES = 32_768;
/** How long a control request waits for its peer: the client for the reply, the endpoint for the line. */
export const CONTROL_REQUEST_TIMEOUT_MS = 2_000;

/** The commands a client of the plain socket sends one request line for. */
export type TControlCommand = Extract<
  TControlCommandName,
  'status' | 'stop' | 'lock' | 'rename' | 'link-pr' | 'unlink-pr' | 'events-list' | 'events-revoke' | 'connect'
>;

export type TSupervisedActivity = 'working' | 'needs-input' | 'idle' | 'unknown';

export function isCurrentActivity(value: unknown): value is Exclude<TSupervisedActivity, 'unknown'> {
  return value === 'working' || value === 'needs-input' || value === 'idle';
}

/** A working directory a control reply may carry: absolute and bounded. */
export function isControlCwd(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && value.length <= 4_096;
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

/** `onRest` receives whatever arrived after the line, for a connection that stays open. */
function readLine(
  socket: IControlChannel,
  maxBytes = MAX_CONTROL_FRAME_BYTES,
  onRest?: (rest: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let received = '';
    let done = false;
    const timer = setTimeout(() => finish(() => reject(new Error('Supervised session control timed out.'))), CONTROL_REQUEST_TIMEOUT_MS);
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
 * `fields` follow `command`, `id` and `generation` on the request line, in the order given.
 */
export async function requestSupervisedControl(
  directory: string,
  id: string,
  generation: string,
  command: TControlCommand,
  signal?: AbortSignal,
  fields: Readonly<Record<string, string>> = {},
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
      socket.setTimeout(CONTROL_REQUEST_TIMEOUT_MS, () => reject(new Error('Supervised session control timed out.')));
    });
    signal?.throwIfAborted();
    socket.write(`${JSON.stringify({ command, id, generation, ...fields })}\n`);
    const response = JSON.parse(
      await readLine(socket, command === 'status' || command === 'events-list'
        ? MAX_STATUS_RESPONSE_BYTES : MAX_CONTROL_FRAME_BYTES),
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

/** The verified `running` reply of a runtime, with the fields every owner of a control endpoint reports. */
export interface ISupervisedRuntimeStatus {
  readonly activity: TSupervisedActivity;
  readonly cwd?: string;
  /** Present only when the live owner reports itself as its workspace's daemon. */
  readonly daemon?: true;
  /** Present only with `daemon`: the daemon runs Restricted, without the project's own configuration. */
  readonly restricted?: true;
  /** Present only when the endpoint reports secure custody. */
  readonly certified?: boolean;
  /** The reply as it arrived once its id and generation were verified, for fields a caller reads itself. */
  readonly reply: Readonly<Record<string, unknown>>;
}

export interface ISupervisedRuntime {
  readonly id: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  /** Present only when control answered. */
  readonly generation?: string;
  readonly problem?: 'invalid-registration';
  readonly control: 'available' | 'unavailable';
  /** Present only when control answered with `running`. */
  readonly status?: ISupervisedRuntimeStatus;
}

function readRuntimeStatus(reply: Readonly<Record<string, unknown>>): ISupervisedRuntimeStatus {
  const cwd = 'cwd' in reply && isControlCwd(reply['cwd']) ? reply['cwd'] : undefined;
  return {
    activity: 'activity' in reply && isCurrentActivity(reply['activity']) ? reply['activity'] : 'unknown',
    ...(cwd !== undefined ? { cwd } : {}),
    ...('daemon' in reply && reply['daemon'] === true
      ? { daemon: true as const,
          ...('restricted' in reply && reply['restricted'] === true ? { restricted: true as const } : {}) }
      : {}),
    ...('certified' in reply && typeof reply['certified'] === 'boolean' ? { certified: reply['certified'] } : {}),
    reply,
  };
}

/**
 * Every registered runtime, in id order, with the `running` reply of each whose control answered.
 * A reply counts only when its owner echoes the id and generation the registration holds; a runtime
 * that is not proven alive, or whose control cannot be reached or does not say `running`, is listed
 * as unavailable instead of being left out.
 */
export async function listSupervisedRuntimes(
  root: string,
  signal?: AbortSignal,
): Promise<readonly ISupervisedRuntime[]> {
  signal?.throwIfAborted();
  const candidates = await listRegisteredCandidates(root, signal);
  const runtimes = await Promise.all(candidates.map(async (candidate): Promise<ISupervisedRuntime> => {
    signal?.throwIfAborted();
    const { id, liveness, generation } = candidate;
    if (liveness !== 'alive' || generation === undefined) {
      return { id, liveness, control: 'unavailable',
        ...(candidate.problem ? { problem: candidate.problem } : {}) };
    }
    try {
      const { directory } = verifyLiveOwner(root, id, generation);
      const response = await requestSupervisedControl(directory, id, generation, 'status', signal);
      if ('status' in response && response.status === 'running') {
        return {
          id, liveness, generation, control: 'available',
          status: readRuntimeStatus(response as Readonly<Record<string, unknown>>),
        };
      }
    } catch {
      signal?.throwIfAborted();
      // A registered process can lose its control endpoint during shutdown.
    }
    return { id, liveness, control: 'unavailable' };
  }));
  return runtimes.sort((a, b) => a.id.localeCompare(b.id));
}

/** Lock one registered secure runtime without opening an owner link. */
export async function lockSupervisedSession(id: string, root: string, expectedGeneration: string): Promise<void> {
  const { directory, generation } = verifyLiveOwner(root, id, expectedGeneration);
  const response = await requestSupervisedControl(directory, id, generation, 'lock');
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
  const response = await requestSupervisedControl(directory, id, generation, 'stop');
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
    await requestSupervisedControl(directory, id, generation, 'stop');
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
      socket.setTimeout(CONTROL_REQUEST_TIMEOUT_MS, () => reject(new Error('Supervised session control timed out.')));
    });
    socket.write(`${JSON.stringify({ command: 'attach', id, generation, mode, protocol: 1 })}\n`);
    let rest = '';
    // Paused until the caller reads the protocol, so no frame is dropped in between.
    const reply = JSON.parse(await readLine(socket, MAX_CONTROL_FRAME_BYTES, (remaining) => {
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
