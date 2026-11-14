import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessOperationLock } from '@robota-sdk/agent-session/node';

import {
  BROKER_LOCK_NAME,
  BROKER_SOCKET_NAME,
  brokerNamespaceName,
  isBrokerNamespaceName,
  isOwnerPrivateDirectory,
  removeBrokerNamespaceDirectory,
  userRootNamespace,
} from './workspace-root-broker-directory.js';
import { requestWorkspaceRootBroker } from './workspace-root-broker.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

const START_MS = 5_000;
// Only source CLI startup loads TypeScript in a separate process.
const SOURCE_START_MS = 15_000;
// A namespace directory younger than this may belong to a broker that is still starting, whose guard is
// not held yet; a start takes at most SOURCE_START_MS, so older ones with no broker are left over.
const STALE_DIRECTORY_MS = 5 * 60 * 1_000;
const SHARED_DIRECTORY = '/tmp';

function brokerDirectory(runtime: ICliRuntimeContext, create = false): string {
  if (process.platform === 'win32') {
    const directory = join(runtime.layout.userRoot, 'root-broker');
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
  const directory = join(SHARED_DIRECTORY, brokerNamespaceName(runtime.layout.userRoot, owner));
  if (create && !existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(directory)) return directory;
  if (!isOwnerPrivateDirectory(lstatSync(directory), owner)) {
    throw new Error('The workspace broker directory is not owner-private.');
  }
  return directory;
}

export function workspaceRootBrokerEndpoint(runtime: ICliRuntimeContext): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\robota-root-${userRootNamespace(runtime.layout.userRoot)}`;
  }
  return join(brokerDirectory(runtime), BROKER_SOCKET_NAME);
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
    return removeBrokerNamespaceDirectory(directory, owner);
  } finally {
    guard.release();
  }
}

/** Start a detached broker once; it serves leases past CLI and desktop sidecar exits until its user-state root is gone. */
export async function ensureWorkspaceRootBroker(runtime: ICliRuntimeContext): Promise<string> {
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  const directory = brokerDirectory(runtime, true);
  if (await isReady(endpoint)) return endpoint;
  // A new broker is being started, so directories of brokers that are gone are the leftovers of earlier
  // ones; sweeping them is off the start's path, and a failed sweep never fails the start.
  void removeStaleBrokerDirectories({ keep: directory }).catch(() => undefined);
  const sourceBin = fileURLToPath(new URL('../bin.ts', import.meta.url));
  const loaderUrl = new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url);
  const source = existsSync(sourceBin) && existsSync(loaderUrl);
  // The CLI runs under Bun only as a compiled executable. Re-enter its embedded main directly;
  // forwarding Bun's platform-specific virtual entry as a script would turn it into an argument.
  const compiledBun = process.versions.bun !== undefined;
  const script = source
    ? ['--import', loaderUrl.href, '--conditions=product-source', sourceBin]
    : !compiledBun && process.argv[1] !== undefined && existsSync(process.argv[1]) &&
        resolve(process.argv[1]) !== resolve(process.execPath)
      ? [process.argv[1]] : [];
  // A persistent child must not pin a disposable workspace or user-state tree as its cwd on Windows.
  const child = spawn(process.execPath, [
    ...(source || compiledBun ? [] : process.execArgv), ...script,
    '--internal-root-broker', endpoint, directory,
    runtime.layout.userPaths.workspaceTrust,
  ], { cwd: parse(process.execPath).root, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let startupError = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    startupError = `${startupError}${chunk.toString('utf8')}`.slice(0, 2_048);
  });
  let outcome: 'ready' | 'exit';
  try {
    outcome = await new Promise<'ready' | 'exit'>((settle, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The workspace broker did not start.')),
        source ? SOURCE_START_MS : START_MS,
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
  // A concurrent CLI may have won the namespace lock. Only attach to its proved live endpoint.
  if (await isReady(endpoint)) return endpoint;
  const detail = startupError.trim();
  throw new Error(detail === ''
    ? 'The workspace broker could not be attached.'
    : `The workspace broker could not be attached: ${detail}`);
}
