import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import { completeSpawnerPair } from '@robota-sdk/agent-transport/link';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { openRegisteredSpawnerLink } from '../owner-link-client.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';
import { launchRuntimeProcess } from '../supervised-session-launch.js';

import type { ChildProcess } from 'node:child_process';

const fixture = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
const noAnswer = fileURLToPath(new URL('../../testing/no-spawner-answer.mjs', import.meta.url));
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

function options(entrypoint = fixture) {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'launch-pair-')));
  roots.push(root);
  const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  return { root, env, runtime, launch: {
    productRuntime: runtime,
    entrypoint,
    execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=product-source'],
    env,
    restricted: true,
    onSpawn: (child: ChildProcess) => children.push(child),
  } };
}

it('exchanges the spawner key before reporting a real secure runtime ready', async () => {
  const { root, runtime, launch } = options();
  const started = await launchRuntimeProcess(root, { ...launch, mode: 'spawner' });
  const supervisedRoot = resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(supervisedRoot, undefined, { includeGeneration: true });
  const row = rows.find((item) => item.id === started.id);
  expect(row?.generation).toBeDefined();
  if (!row?.generation) throw new Error('Secure runtime has no generation');
  const link = await openRegisteredSpawnerLink({ root: supervisedRoot, id: started.id, generation: row.generation, spawnerKey: started.spawnerKey, instancePublicKey: started.instancePublicKey });
  expect(link.standing).toBe('spawner');
  const child = children[children.length - 1];
  if (!child) throw new Error('Missing child');
  const stopped = once(child, 'exit');
  link.close();
  started.spawnerKey.wipe();
  await stopped;
}, 60_000);

it('uses an explicit desktop sidecar command instead of this process entry', async () => {
  const { root, runtime, launch } = options('/missing/electron-main.js');
  const started = await launchRuntimeProcess(root, {
    ...launch,
    mode: 'spawner',
    launchCommand: {
      executable: process.execPath,
      args: [...launch.execArgs, fixture],
    },
  });
  const supervisedRoot = resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(supervisedRoot, undefined, { includeGeneration: true });
  const row = rows.find((item) => item.id === started.id);
  expect(row?.generation).toBeDefined();
  if (row?.generation) await stopSupervisedSession(started.id, supervisedRoot, row.generation);
  started.spawnerKey.wipe();
}, 60_000);

it('ends a child that never answers the exchange, without accepting readiness', async () => {
  const { root, launch } = options(noAnswer);
  await expect(launchRuntimeProcess(root, { ...launch, mode: 'spawner', pairTimeoutMs: 400 })).rejects.toThrow(/exchange|pair/i);
  const child = children[children.length - 1];
  expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
}, 15_000);

it('redacts every passed reference from a secure child startup failure', async () => {
  const entrypoint = fileURLToPath(new URL('../../testing/spawner-stderr-child.ts', import.meta.url));
  const { root, launch } = options(entrypoint);
  const env = { ...launch.env, REFERENCE_ONLY: 'synthetic-spawner-reference-value', REFERENCE_SHORT: 'xY' };
  await expect(launchRuntimeProcess(root, { ...launch, env, mode: 'spawner' })).rejects.toSatisfy((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return message.includes('startup failure') && !message.includes('synthetic-spawner-reference-value') && !message.includes('xY');
  });
}, 30_000);


it('forwards an inherited pair to a secure grandchild and closes its own copy', async () => {
  const { root, env, runtime } = options();
  const forwarder = fileURLToPath(new URL('../../testing/forward-spawner-pair.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=product-source', forwarder], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe'] });
  children.push(child);
  const pipe = child.stdio[4];
  if (!(pipe instanceof Duplex)) throw new Error('Missing outer spawner pair');
  const message = once(child, 'message');
  const [pair, [reply]] = await Promise.all([completeSpawnerPair(pipe), message]);
  if (typeof reply !== 'object' || reply === null || !('id' in reply) || typeof reply.id !== 'string') throw new Error('Forwarder failed');
  expect(reply).toHaveProperty('pairClosed', true);
  const supervisedRoot = resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(supervisedRoot, undefined, { includeGeneration: true });
  const row = rows.find((item) => item.id === reply.id);
  if (!row?.generation) throw new Error('Forwarded runtime has no generation');
  const link = await openRegisteredSpawnerLink({ root: supervisedRoot, id: reply.id, generation: row.generation, ...pair });
  expect(link.standing).toBe('spawner');
  await stopSupervisedSession(reply.id, supervisedRoot, row.generation);
  link.close();
  pair.spawnerKey.wipe();
}, 60_000);
