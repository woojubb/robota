import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestWorkspaceRootBroker } from './workspace-root-broker.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

const START_MS = 5_000;

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
  const namespace = createHash('sha256').update(runtime.layout.userRoot).digest('hex').slice(0, 24);
  const directory = join('/tmp', `robota-root-${owner}-${namespace}`);
  if (create && !existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(directory)) return directory;
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== owner ||
      (metadata.mode & 0o077) !== 0) {
    throw new Error('The workspace broker directory is not owner-private.');
  }
  return directory;
}

export function workspaceRootBrokerEndpoint(runtime: ICliRuntimeContext): string {
  if (process.platform === 'win32') {
    const namespace = createHash('sha256').update(runtime.layout.userRoot).digest('hex').slice(0, 24);
    return `\\\\.\\pipe\\robota-root-${namespace}`;
  }
  return join(brokerDirectory(runtime), 'broker.sock');
}

async function isReady(endpoint: string): Promise<boolean> {
  try {
    return (await requestWorkspaceRootBroker(endpoint, { op: 'ping' })).status === 'ready';
  } catch {
    return false;
  }
}

/** Start a detached broker once; a normal CLI or desktop sidecar exit leaves it serving leases. */
export async function ensureWorkspaceRootBroker(runtime: ICliRuntimeContext): Promise<string> {
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  brokerDirectory(runtime, true);
  if (await isReady(endpoint)) return endpoint;
  const sourceBin = fileURLToPath(new URL('../bin.ts', import.meta.url));
  const sourceLoader = fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url));
  const source = existsSync(sourceBin) && existsSync(sourceLoader);
  const script = source
    ? ['--import', sourceLoader, '--conditions=source', sourceBin]
    : process.argv[1] !== undefined && existsSync(process.argv[1]) &&
        resolve(process.argv[1]) !== resolve(process.execPath)
      ? [process.argv[1]] : [];
  const child = spawn(process.execPath, [
    ...(source ? [] : process.execArgv), ...script,
    '--internal-root-broker', endpoint, brokerDirectory(runtime),
    runtime.layout.userPaths.workspaceTrust,
  ], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let outcome: 'ready' | 'exit';
  try {
    outcome = await new Promise<'ready' | 'exit'>((settle, reject) => {
      const timer = setTimeout(() => reject(new Error('The workspace broker did not start.')), START_MS);
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
  child.unref();
  if (outcome === 'ready' && await isReady(endpoint)) return endpoint;
  // A concurrent CLI may have won the namespace lock. Only attach to its proved live endpoint.
  if (await isReady(endpoint)) return endpoint;
  throw new Error('The workspace broker could not be attached.');
}
