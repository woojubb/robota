/** Same-user probes against a real source CLI runtime, with a plain negative control. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKeyring, createRuntimeIdentity, openOwnerHandover, startSpawnerExchange } from '../../packages/agent-keyring/src/index.ts';
import { completeSpawnerPair, openOwnerLink, openSpawnerLink } from '../../packages/agent-transport-link/src/index.ts';
import { createTestBinaryEnvironment, createTestProductRuntime } from '../../packages/agent-cli/src/__tests__/helpers/product-runtime.ts';
import { connectSupervisedDaemon, listSupervisedSessions, openSupervisedAttachSocket, resolveSupervisedDirectory } from '../../packages/agent-cli/src/session-inventory/supervised-session-control.ts';
import { windowsControlPipePath } from '../../packages/agent-cli/src/session-inventory/windows-control-pipe.ts';

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(repo, 'packages/agent-cli');
const loader = createRequire(join(cli, 'package.json')).resolve('tsx');
const plain = process.argv.includes('--plain-negative-control');
const temporaryRoot = process.platform === 'win32' ? tmpdir() : realpathSync('/tmp');
const root = realpathSync(mkdtempSync(join(temporaryRoot, 'adversary-')));
const env = createTestBinaryEnvironment(root, { PRODUCT_TELEMETRY_ENABLED: '0' });
const runtime = createTestProductRuntime('test-product', env);
const id = randomUUID();
const entry = join(cli, plain ? 'src/testing/plain-runtime-entry.ts' : 'src/testing/secure-runtime-entry.ts');
const mode = plain ? ['--daemon', '--supervised-transport-token-fd'] : ['--supervised-spawner-pair'];
const child = spawn(process.execPath, ['--import', loader, '--conditions=source', entry, '--serve', '--safe-mode', '--supervised-session-id', id, ...mode], {
  cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
});
const watchdog = setTimeout(() => child.kill('SIGKILL'), 25_000);
watchdog.unref();
let stderr = '';
child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
const ready = new Promise((resolve, reject) => {
  child.on('message', (message) => {
    if (message?.kind === 'ready' && message.id === id) child.send({ kind: 'ack', id });
    else if (message?.kind === 'acknowledged' && message.id === id) resolve();
  });
  child.once('exit', () => reject(new Error(`Runtime exited before readiness: ${stderr}`)));
});
const pair = child.stdio[4];
let key;
let link;
let ownerLink;
let owner;
try {
  if (plain) {
    pair.end(randomBytes(32).toString('hex'));
    await ready;
  } else {
    [key] = await Promise.all([completeSpawnerPair(pair), ready]);
  }
  const supervised = resolveSupervisedDirectory(runtime);
  const rows = await listSupervisedSessions(supervised, undefined, { includeGeneration: true });
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row?.generation && row.control === 'available', 'the real runtime must be reachable');
  async function mustRefuse(name, attempt) {
    try { await attempt(); } catch { return; }
    throw new Error(`${name} unexpectedly succeeded`);
  }
  await mustRefuse('plain connect', () => connectSupervisedDaemon(id, supervised, row.generation));
  await mustRefuse('plain attach', () => openSupervisedAttachSocket(id, 'drive', supervised, row.generation));
  const socketPath = process.platform === 'win32'
    ? windowsControlPipePath(supervised, id)
    : join(supervised, `${createHash('sha256').update(id).digest('hex').slice(0, 16)}.sock`);
  const connect = async () => {
    const socket = createConnection(socketPath);
    await once(socket, 'connect');
    return socket;
  };
  const staleGeneration = row.generation === 'A'.repeat(22) ? 'B'.repeat(22) : 'A'.repeat(22);
  const staleSocket = await connect();
  const staleAnswer = new Promise((resolve, reject) => {
    let received = '';
    staleSocket.on('data', (part) => {
      received += part.toString();
      const end = received.indexOf('\n');
      if (end >= 0) {
        try { resolve(JSON.parse(received.slice(0, end))); } catch (error) { reject(error); }
        staleSocket.destroy();
      }
    });
    staleSocket.once('error', reject);
  });
  staleSocket.write(`${JSON.stringify({ command: 'status', id, generation: staleGeneration })}\n`);
  assert.equal((await staleAnswer).reason, 'stale-generation');
  const passphrase = 'fixture-only-adversary-passphrase';
  const made = await createKeyring({ passphrase });
  made.unlocked.lock();
  owner = await openOwnerHandover(made.keyring, { type: 'passphrase', passphrase });
  await mustRefuse('uncertified owner', async () => openOwnerLink(await connect(), owner));
  const wrongExchange = startSpawnerExchange();
  const wrong = wrongExchange.complete(createRuntimeIdentity().answerSpawnerExchange(wrongExchange.message));
  try {
    await mustRefuse('wrong spawner key', async () => openSpawnerLink(await connect(), wrong.spawnerKey, key.instancePublicKey));
  } finally { wrong.spawnerKey.wipe(); }
  link = await openSpawnerLink(await connect(), key.spawnerKey, key.instancePublicKey);
  assert.equal(link.standing, 'spawner');
  await mustRefuse('spawner rename', () => link.control({ command: 'rename', fields: { name: 'Intruder' } }));
  await mustRefuse('spawner question', () => link.question('another session'));
  const trustRoot = owner.certify(link.instancePublicKey, link.binding);
  await link.installTrustRoot(trustRoot);
  await link.closed;
  await mustRefuse('second trust root', () => link.installTrustRoot(trustRoot));
  await mustRefuse('spawner replay after certification', async () => openSpawnerLink(await connect(), key.spawnerKey, key.instancePublicKey));
  ownerLink = await openOwnerLink(await connect(), owner);
  assert.equal(ownerLink.standing, 'owner');
  console.log('secure runtime refused plain connect, plain attach, a wrong spawner key, and spawner owner requests; certification admitted the owner');
} finally {
  clearTimeout(watchdog);
  ownerLink?.close();
  owner?.dispose();
  link?.close();
  key?.spawnerKey.wipe();
  if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
}
