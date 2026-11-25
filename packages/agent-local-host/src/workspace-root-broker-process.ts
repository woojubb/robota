import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join, parse } from 'node:path';

import { createProcessOperationLock } from '@robota-sdk/agent-session/node';

import {
  BROKER_LOCK_NAME,
  BROKER_SOCKET_NAME,
  brokerNamespaceName,
  claimBrokerNamespaceDirectory,
  isBrokerNamespaceName,
  isOwnerPrivateDirectory,
  removeBrokerNamespaceDirectory,
  userRootNamespace,
} from './workspace-root-broker-directory.js';
import { requestWorkspaceRootBroker } from './workspace-root-broker.js';

/** What a start needs to know about the product state a broker serves. */
export interface IWorkspaceRootBrokerStart {
  /** The user-state root whose approvals the broker retains; it names the broker's endpoint and directory. */
  readonly userRoot: string;
  /** The approvals file inside that root; the broker ends when its root is gone. */
  readonly historyFile: string;
}

/** The three values a broker child needs, the arguments of `startWorkspaceRootBroker`. */
export interface IWorkspaceRootBrokerServe {
  readonly endpoint: string;
  readonly lockDirectory: string;
  readonly historyFile: string;
}

/** The process that runs a broker, and how long a start may take before it fails. */
export interface IWorkspaceRootBrokerLaunch {
  readonly executable: string;
  readonly args: readonly string[];
  readonly startMs: number;
}

/**
 * How the composition root runs its own binary as a broker: the child it names must call
 * `startWorkspaceRootBroker` with the given values and send `ready` over its IPC channel once it
 * serves. It is asked only when no live broker answers, so a live broker costs the host no work, and
 * it carries no authority: the package decides the endpoint, the directory and the process options.
 */
export type TWorkspaceRootBrokerLauncher = (broker: IWorkspaceRootBrokerServe) => IWorkspaceRootBrokerLaunch;

// A namespace directory younger than this may belong to a broker that is still starting, whose guard is
// not held yet; a start is bounded by the launcher's `startMs`, far below this, so older ones with no
// broker are left over.
const STALE_DIRECTORY_MS = 5 * 60 * 1_000;
const SHARED_DIRECTORY = '/tmp';

function brokerDirectory(userRoot: string, create = false): string {
  if (process.platform === 'win32') {
    const directory = join(userRoot, 'root-broker');
    if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existsSync(directory)) return directory;
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('The Windows workspace broker lock directory is invalid.');
    }
    return directory;
  }
  const owner = process.getuid?.();
  if (owner === undefined) throw new Error('The broker owner could not be determined.');
  const directory = join(SHARED_DIRECTORY, brokerNamespaceName(userRoot, owner));
  if (create) claimBrokerNamespaceDirectory(directory, owner);
  if (!existsSync(directory)) return directory;
  if (!isOwnerPrivateDirectory(lstatSync(directory), owner)) {
    throw new Error('The workspace broker directory is not owner-private.');
  }
  return directory;
}

export function workspaceRootBrokerEndpoint(userRoot: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\robota-root-${userRootNamespace(userRoot)}`;
  }
  return join(brokerDirectory(userRoot), BROKER_SOCKET_NAME);
}

async function isReady(endpoint: string): Promise<boolean> {
  try {
    return (await requestWorkspaceRootBroker(endpoint, { op: 'ping' })).status === 'ready';
  } catch {
    return false;
  }
}

/**
 * Removes the namespace directories that brokers left behind: those whose socket answers no ping and
 * whose guard nobody holds. A directory is touched only when its name is exactly a namespace name of
 * this user and it is a real, owner-private directory old enough that no broker is still starting in
 * it; `keep` (the directory the caller is about to use) is never touched. Returns how many it removed.
 */
export async function removeStaleBrokerDirectories(options: {
  readonly parent?: string;
  readonly owner?: number;
  readonly keep?: string;
} = {}): Promise<number> {
  const owner = options.owner ?? process.getuid?.();
  if (process.platform === 'win32' || owner === undefined) return 0;
  const parent = options.parent ?? SHARED_DIRECTORY;
  let removed = 0;
  for (const name of readdirSync(parent)) {
    if (!isBrokerNamespaceName(name, owner)) continue;
    const directory = join(parent, name);
    if (directory === options.keep) continue;
    try {
      if (await removeIfBrokerIsGone(directory, owner)) removed += 1;
    } catch {
      // Another start changed or removed it meanwhile; a directory that cannot be proven stale is kept.
    }
  }
  return removed;
}

async function removeIfBrokerIsGone(directory: string, owner: number): Promise<boolean> {
  const listed = lstatSync(directory);
  if (!isOwnerPrivateDirectory(listed, owner) || Date.now() - listed.mtimeMs < STALE_DIRECTORY_MS) {
    return false;
  }
  if (await isReady(join(directory, BROKER_SOCKET_NAME))) return false;
  const guard = createProcessOperationLock(directory).tryAcquire(BROKER_LOCK_NAME);
  if (guard === undefined) return false;
  try {
    const held = lstatSync(directory);
    if (held.dev !== listed.dev || held.ino !== listed.ino) return false;
    // A start that claimed the directory since the first look has a broker on its way that does not hold the guard yet.
    if (Date.now() - held.mtimeMs < STALE_DIRECTORY_MS) return false;
    return removeBrokerNamespaceDirectory(directory, owner);
  } finally {
    guard.release();
  }
}

/** Start a detached broker once; it serves leases past host exits until its user-state root is gone. */
export async function ensureWorkspaceRootBroker(
  start: IWorkspaceRootBrokerStart,
  launcher: TWorkspaceRootBrokerLauncher,
): Promise<string> {
  // Claiming the directory comes first: it is what keeps a sweep from reading a leftover as a broker that is gone.
  const directory = brokerDirectory(start.userRoot, true);
  const endpoint = workspaceRootBrokerEndpoint(start.userRoot);
  if (await isReady(endpoint)) return endpoint;
  // A new broker is being started, so directories of brokers that are gone are the leftovers of earlier
  // ones; sweeping them is off the start's path, and a failed sweep never fails the start.
  void removeStaleBrokerDirectories({ keep: directory }).catch(() => undefined);
  const launch = launcher({ endpoint, lockDirectory: directory, historyFile: start.historyFile });
  // A persistent child must not pin a disposable workspace or user-state tree as its cwd on Windows.
  const child = spawn(launch.executable, [...launch.args], {
    cwd: parse(launch.executable).root,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let startupError = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    startupError = `${startupError}${chunk.toString('utf8')}`.slice(0, 2_048);
  });
  let outcome: 'ready' | 'exit';
  try {
    outcome = await new Promise<'ready' | 'exit'>((settle, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The workspace broker did not start.')),
        launch.startMs,
      );
      const finish = (value: 'ready' | 'exit') => { clearTimeout(timer); settle(value); };
      child.once('message', (message) => finish(message === 'ready' ? 'ready' : 'exit'));
      child.once('exit', () => finish('exit'));
      child.once('error', reject);
    });
  } catch (error) {
    child.kill();
    if (child.connected) child.disconnect();
    throw error;
  }
  if (child.connected) child.disconnect();
  child.stderr?.destroy();
  child.unref();
  if (outcome === 'ready' && await isReady(endpoint)) return endpoint;
  // A concurrent host may have won the namespace lock. Only attach to its proved live endpoint.
  if (await isReady(endpoint)) return endpoint;
  const detail = startupError.trim();
  throw new Error(detail === ''
    ? 'The workspace broker could not be attached.'
    : `The workspace broker could not be attached: ${detail}`);
}
