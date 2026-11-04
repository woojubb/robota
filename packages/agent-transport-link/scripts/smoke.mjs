// Runtime smoke for the BUILT carrier over a real loopback socket pair: a spawner link certifies the
// runtime, then an owner link unlocks it with a read grant and carries a session frame each way.
// Run under both runtimes: `node scripts/smoke.mjs` and `bun scripts/smoke.mjs`.
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';

import {
  createKeyring,
  createRuntimeIdentity,
  openOwnerHandover,
  startSpawnerExchange,
} from '@robota-sdk/agent-keyring';

import {
  isLinkRequest,
  openOwnerLink,
  openSpawnerLink,
  serveRuntimeLink,
} from '../dist/node/index.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`;
const binding = { runtimeId: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', generation: 'smoke' };

const created = await createKeyring({ passphrase: 'a passphrase for the carrier smoke' });
const handover = await openOwnerHandover(created.keyring, {
  type: 'recoveryKey',
  recoveryKey: created.recoveryKey,
});

// The runtime: its exchange over the (here simulated) inherited pair, then its control endpoint.
const identity = createRuntimeIdentity();
const exchange = startSpawnerExchange();
const { spawnerKey, instancePublicKey } = exchange.complete(
  identity.answerSpawnerExchange(exchange.message),
);
const received = [];
const granted = [];
const links = [];
const admit = (link) => {
  links.push(link);
  return {
    desk: {
      custody: () => ({ unlocked: granted.length > 0, certified: identity.certified }),
      installTrustRoot: (root) => identity.installTrustRoot(root, link.binding),
      unlock: (keys) => (granted.push(keys), 'verified'),
      lock: () => undefined,
      control: () => ({ status: 'ok' }),
      closed: () => undefined,
    },
    sessions: { question: () => ({ kind: 'open' }), openAccepted: () => undefined },
    session: { receive: (data) => received.push(JSON.parse(data)) },
  };
};
const server = createServer((socket) => {
  let buffered = Buffer.alloc(0);
  const onData = (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    const end = buffered.indexOf(0x0a);
    if (end === -1) return;
    socket.off('data', onData);
    socket.pause();
    if (!isLinkRequest(JSON.parse(buffered.subarray(0, end).toString('utf8')))) {
      socket.destroy();
      return;
    }
    serveRuntimeLink(socket, { identity, binding, rest: buffered.subarray(end + 1), admit });
  };
  socket.on('data', onData);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const connected = () =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
const until = async (condition) => {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
};

const spawner = await openSpawnerLink(await connected(), spawnerKey, instancePublicKey);
assert.equal(spawner.standing, 'spawner');
assert.deepEqual(spawner.binding, binding);
await spawner.installTrustRoot(handover.certify(spawner.instancePublicKey, spawner.binding));
spawnerKey.wipe();
spawner.close();
await spawner.closed;
assert.equal(identity.certified, true);

const owner = await openOwnerLink(await connected(), handover);
assert.equal(owner.standing, 'owner');
assert.deepEqual(owner.custody, { unlocked: false, certified: true });
assert.equal(await owner.unlock(), 'verified');
assert.deepEqual(granted[0].sealing.publicKey, created.unlocked.sealing.publicKey);
owner.session.send({ type: 'submit', prompt: 'hello' });
await until(() => received.length === 1);
assert.deepEqual(received[0], { type: 'submit', prompt: 'hello' });
const heard = [];
owner.session.onMessage((message) => heard.push(message));
links.at(-1).sendSession(JSON.stringify({ type: 'text_delta', delta: 'hi' }));
await until(() => heard.length === 1);
assert.deepEqual(heard[0], { type: 'text_delta', delta: 'hi' });
await owner.lock('explicit');
owner.close();
await owner.closed;

granted[0].lock();
created.unlocked.lock();
handover.dispose();
await new Promise((resolve) => server.close(resolve));
console.log(`OK ${runtime}`);
