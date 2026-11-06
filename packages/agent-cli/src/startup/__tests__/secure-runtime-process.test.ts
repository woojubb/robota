import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Duplex } from 'node:stream';

import { createRuntimeIdentity, startSpawnerExchange } from '@robota-sdk/agent-keyring';
import { completeSpawnerPair, openSpawnerLink } from '@robota-sdk/agent-transport-link';
import { afterEach, expect, it } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { connectSupervisedDaemon, listSupervisedSessions, openSupervisedAttachSocket, resolveSupervisedDirectory } from '../../session-inventory/supervised-session-control.js';
import { windowsControlPipePath } from '@robota-sdk/agent-local-host';

const fixture = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
const recorder = new URL('../../testing/spawn-recorder.mjs', import.meta.url).href;
const roots: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

it('starts the real secure CLI runtime and admits its spawner on the control socket', async () => {
  const temporaryRoot = process.platform === 'win32' ? tmpdir() : realpathSync('/tmp');
  const root = realpathSync(mkdtempSync(join(temporaryRoot, 'sa-')));
  roots.push(root);
  const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const id = randomUUID();
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--import', recorder, '--conditions=source', fixture, '--serve', '--safe-mode', '--supervised-session-id', id, '--supervised-spawner-pair'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
  });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', (part: Buffer) => { stderr += part.toString(); });
  const ready = new Promise<void>((resolve, reject) => {
    child.on('message', (message: unknown) => {
      if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'ready') {
        child.send({ kind: 'ack', id });
      } else if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'acknowledged') {
        resolve();
      }
    });
    child.once('exit', () => reject(new Error(`Secure runtime exited before readiness: ${stderr}`)));
  });
  const pair = child.stdio[4];
  if (!(pair instanceof Duplex)) throw new Error('Missing spawner pair');
  const [{ spawnerKey, instancePublicKey }] = await Promise.all([completeSpawnerPair(pair), ready]);
  expect(stderr).toContain('TEST_SPAWNER_PAIR_CLOSED');
  const supervisedRoot = resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(supervisedRoot, undefined, { includeGeneration: true });
  const row = rows.find((candidate) => candidate.id === id);
  expect(row?.control).toBe('available');
  expect(row?.generation).toBeDefined();
  await expect(connectSupervisedDaemon(id, supervisedRoot, row?.generation)).rejects.toThrow();
  await expect(openSupervisedAttachSocket(id, 'drive', supervisedRoot, row?.generation)).rejects.toThrow();
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 16);
  const socketPath = process.platform === 'win32'
    ? windowsControlPipePath(supervisedRoot, id)
    : join(supervisedRoot, `${hash}.sock`);
  const otherExchange = startSpawnerExchange();
  const other = otherExchange.complete(createRuntimeIdentity().answerSpawnerExchange(otherExchange.message));
  const impostor = createConnection(socketPath);
  await once(impostor, 'connect');
  await expect(openSpawnerLink(impostor, other.spawnerKey, instancePublicKey)).rejects.toThrow();
  other.spawnerKey.wipe();
  const socket = createConnection(socketPath);
  await once(socket, 'connect');
  const client = await openSpawnerLink(socket, spawnerKey, instancePublicKey);
  expect(client.standing).toBe('spawner');
  await expect(client.control({ command: 'rename', fields: { name: 'Not the owner' } })).rejects.toThrow();
  await expect(client.question('another session')).rejects.toThrow();
  const stopped = once(child, 'exit');
  client.close();
  spawnerKey.wipe();
  await stopped;
}, 60_000);
