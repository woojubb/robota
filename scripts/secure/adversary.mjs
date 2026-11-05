/** Same-user probes against a real source CLI runtime, with a plain negative control. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINK_HELLO_BYTES, createKeyring, createLinkResponder, createRuntimeIdentity, openOwnerHandover, startSpawnerExchange } from '../../packages/agent-keyring/src/index.ts';
import { LINK_REQUEST_LINE, completeSpawnerPair, openOwnerLink, openSpawnerLink } from '../../packages/agent-transport-link/src/index.ts';
import { createTestBinaryEnvironment, createTestProductRuntime } from '../../packages/agent-cli/src/__tests__/helpers/product-runtime.ts';
import { connectSupervisedDaemon, listSupervisedSessions, openSupervisedAttachSocket, resolveSupervisedDirectory } from '../../packages/agent-cli/src/session-inventory/supervised-session-control.ts';
import { windowsControlPipePath } from '../../packages/agent-cli/src/session-inventory/windows-control-pipe.ts';
import { createKeyringFileStore } from '../../packages/agent-cli/src/secure/keyring-store.ts';

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
let secondChild;
let grantChild;
const watchdog = setTimeout(() => { child.kill('SIGKILL'); secondChild?.kill('SIGKILL'); grantChild?.kill('SIGKILL'); }, 25_000);
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
  const stranger = await createKeyring({ passphrase: 'fixture-other-passphrase' });
  stranger.unlocked.lock();
  const store = createKeyringFileStore({ path: runtime.layout.userPaths.keyring, root: runtime.layout.userRoot });
  store.create({ ...made.keyring, sealingPublicKey: stranger.keyring.sealingPublicKey });
  const swappedFile = readFileSync(store.path);
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
  assert.equal(await ownerLink.unlock(), 'mismatch', 'a swapped sealing key is reported to the owner');
  assert.deepEqual(readFileSync(store.path), swappedFile, 'unlock must not rewrite the swapped keyring');
  const strangerOwner = await openOwnerHandover(stranger.keyring, { type: 'passphrase', passphrase: 'fixture-other-passphrase' });
  try {
    const impostor = createRuntimeIdentity();
    const impostorExchange = startSpawnerExchange();
    const impostorKey = impostorExchange.complete(impostor.answerSpawnerExchange(impostorExchange.message));
    impostorKey.spawnerKey.wipe();
    impostor.installTrustRoot(strangerOwner.certify(impostor.instancePublicKey, link.binding), link.binding);
    const observed = [];
    let acceptedSocket;
    let reportClose;
    const closed = new Promise((resolve) => { reportClose = resolve; });
    const squatter = createServer((socket) => {
      acceptedSocket = socket;
      let buffered = Buffer.alloc(0);
      let answered = false;
      socket.on('data', (chunk) => {
        observed.push(chunk);
        buffered = Buffer.concat([buffered, chunk]);
        const start = buffered.indexOf(0x0a) + 1;
        if (!answered && start > 0 && buffered.length >= start + 4 + LINK_HELLO_BYTES) {
          answered = true;
          const challenge = createLinkResponder(impostor, link.binding).challenge(buffered.subarray(start + 4, start + 4 + LINK_HELLO_BYTES));
          const header = Buffer.alloc(4);
          header.writeUInt32BE(challenge.length);
          socket.write(Buffer.concat([header, challenge]));
        }
      });
      socket.once('close', reportClose);
    });
    const fakePath = join(root, 'squatter.sock');
    try {
      squatter.listen(fakePath);
      await once(squatter, 'listening');
      const fakeSocket = createConnection(fakePath);
      await once(fakeSocket, 'connect');
      await mustRefuse('owner proof to a certified impostor', () => openOwnerLink(fakeSocket, owner));
      await closed;
      const disclosed = Buffer.concat(observed);
      const requestLength = Buffer.byteLength(LINK_REQUEST_LINE);
      assert.equal(disclosed.subarray(0, requestLength).toString(), LINK_REQUEST_LINE);
      assert.equal(disclosed.readUInt32BE(requestLength), LINK_HELLO_BYTES);
      assert.equal(disclosed.length, requestLength + 4 + LINK_HELLO_BYTES, 'the impostor must receive no owner proof or grant');
    } finally {
      acceptedSocket?.destroy();
      await new Promise((resolve) => squatter.close(resolve));
    }
  } finally { strangerOwner.dispose(); }
  const secondId = randomUUID();
  secondChild = spawn(process.execPath, ['--import', loader, '--conditions=source', entry, '--serve', '--safe-mode', '--supervised-session-id', secondId, '--supervised-spawner-pair'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
  });
  let secondStderr = '';
  secondChild.stderr?.on('data', (chunk) => { secondStderr += chunk.toString(); });
  const secondReady = new Promise((resolve, reject) => {
    secondChild.on('message', (message) => {
      if (message?.kind === 'ready' && message.id === secondId) secondChild.send({ kind: 'ack', id: secondId });
      else if (message?.kind === 'acknowledged' && message.id === secondId) resolve();
    });
    secondChild.once('exit', () => reject(new Error(`Second runtime exited before readiness: ${secondStderr}`)));
  });
  const [secondKey] = await Promise.all([completeSpawnerPair(secondChild.stdio[4]), secondReady]);
  try {
    const secondPath = process.platform === 'win32'
      ? windowsControlPipePath(supervised, secondId)
      : join(supervised, `${createHash('sha256').update(secondId).digest('hex').slice(0, 16)}.sock`);
    const connectSecond = async () => {
      const socket = createConnection(secondPath);
      await once(socket, 'connect');
      return socket;
    };
    await mustRefuse('spawner key replay into a second runtime', async () => openSpawnerLink(await connectSecond(), key.spawnerKey, secondKey.instancePublicKey));
    const secondLink = await openSpawnerLink(await connectSecond(), secondKey.spawnerKey, secondKey.instancePublicKey);
    assert.equal(secondLink.standing, 'spawner');
    secondLink.close();
  } finally {
    secondKey.spawnerKey.wipe();
  }
  const grantId = randomUUID();
  grantChild = spawn(process.execPath, ['--import', loader, '--conditions=source', entry, '--serve', '--safe-mode', '--supervised-session-id', grantId, '--supervised-spawner-pair', '--supervised-external-event-grants', '--external-event-port', '34567'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'],
  });
  let grantStderr = '';
  grantChild.stderr?.on('data', (chunk) => { grantStderr += chunk.toString(); });
  const grantExit = once(grantChild, 'exit');
  const grantKey = await completeSpawnerPair(grantChild.stdio[4]);
  grantKey.spawnerKey.wipe();
  const [grantCode] = await grantExit;
  assert.equal(grantCode, 1, 'secure start with external-event grants must fail');
  assert.match(grantStderr, /External events do not start in secure mode/u);
  const afterGrant = await listSupervisedSessions(supervised);
  assert.equal(afterGrant.some((candidate) => candidate.id === grantId), false, 'the refused start must not register a control endpoint');
  console.log('secure runtime refused plain connect, plain attach, a wrong spawner key, spawner owner requests, and replay into a second runtime; certification admitted the owner; swapped-key grant reported mismatch; an impostor received no proof; external-event start was refused');
} finally {
  clearTimeout(watchdog);
  ownerLink?.close();
  owner?.dispose();
  link?.close();
  key?.spawnerKey.wipe();
  if (grantChild && grantChild.exitCode === null && grantChild.signalCode === null) {
    const ended = once(grantChild, 'exit');
    grantChild.kill();
    await ended;
  }
  if (secondChild && secondChild.exitCode === null && secondChild.signalCode === null) {
    const ended = once(secondChild, 'exit');
    secondChild.kill();
    await ended;
  }
  if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
}
