import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requestWorkspaceRootBroker } from './workspace-root-broker.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

const START_MS = 5_000;
// Only source CLI startup loads TypeScript in a separate process.
const SOURCE_START_MS = 15_000;

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
  const directory = brokerDirectory(runtime, true);
  if (await isReady(endpoint)) return endpoint;
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
