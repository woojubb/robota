import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readProcessStartTime } from '@robota-sdk/agent-core/node';
import { createKeyring, createRuntimeIdentity, openOwnerHandover, startSpawnerExchange } from '@robota-sdk/agent-keyring';
import { afterEach, expect, it } from 'vitest';

import { KeyHolder } from '@robota-sdk/agent-local-host';
import { RuntimeCustody } from '../../secure/runtime-custody.js';
import { createMemoryKeyringStore, FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { openRegisteredOwnerLink, openRegisteredSpawnerLink } from '../owner-link-client.js';
import { startSupervisedControl, type ISupervisedControl } from '../supervised-session-control.js';

const ID = '7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const roots: string[] = [];
const controls: ISupervisedControl[] = [];
const links: { close(): void }[] = [];
afterEach(async () => {
  for (const link of links.splice(0)) link.close();
  for (const control of controls.splice(0)) await control.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('opens a spawner and then its certified owner only for the selected runtime registration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'owner-client-'));
  roots.push(root);
  const { keyring } = await fixtureKeyring();
  const owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  try {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    const { spawnerKey, instancePublicKey } = exchange.complete(identity.answerSpawnerExchange(exchange.message));
    const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
    const custody = new RuntimeCustody({ identity, holder, attachTarget: { session: {} as never } });
    controls.push(await startSupervisedControl({ id: ID, root, onStop: () => {}, admission: custody.admission }));
    const file = join(root, ID, 'state.json');
    const registration = JSON.parse(readFileSync(file, 'utf8'));
    const expected = { root, id: ID, generation: registration.generation };

    // A stale displayed row never reaches the runtime.
    await expect(openRegisteredSpawnerLink({ ...expected, generation: 'A'.repeat(22), spawnerKey, instancePublicKey })).rejects.toThrow(/changed/i);
    // Even a forged registration with the right process and a different generation cannot redirect the link.
    writeFileSync(file, JSON.stringify({ ...registration, generation: 'A'.repeat(22) }), { mode: 0o600 });
    await expect(openRegisteredSpawnerLink({ ...expected, generation: 'A'.repeat(22), spawnerKey, instancePublicKey })).rejects.toThrow(/binding|registration/i);
    writeFileSync(file, JSON.stringify(registration), { mode: 0o600 });

    const spawner = await openRegisteredSpawnerLink({ ...expected, spawnerKey, instancePublicKey });
    links.push(spawner);
    expect(spawner.binding).toEqual({ runtimeId: ID, generation: expected.generation });
    await spawner.installTrustRoot(owner.certify(spawner.instancePublicKey, spawner.binding));
    await spawner.closed;
    const other = await createKeyring({ passphrase: 'other correct passphrase' });
    other.unlocked.lock();
    const stranger = await openOwnerHandover(other.keyring, { type: 'passphrase', passphrase: 'other correct passphrase' });
    try {
      await expect(openRegisteredOwnerLink({ ...expected, handover: stranger })).rejects.toThrow();
    } finally {
      stranger.dispose();
    }
    writeFileSync(file, JSON.stringify({ ...registration, generation: 'A'.repeat(22) }), { mode: 0o600 });
    await expect(openRegisteredOwnerLink({ ...expected, generation: 'A'.repeat(22), handover: owner })).rejects.toThrow(/binding|registration/i);
    writeFileSync(file, JSON.stringify(registration), { mode: 0o600 });
    const aborted = new AbortController();
    aborted.abort();
    await expect(openRegisteredOwnerLink({ ...expected, handover: owner, signal: aborted.signal })).rejects.toThrow();
    const client = await openRegisteredOwnerLink({ ...expected, handover: owner });
    links.push(client);
    expect(client.binding).toEqual({ runtimeId: ID, generation: expected.generation });
    expect((await client.control({ command: 'status', fields: {} })).status).toBe('running');
  } finally {
    owner.dispose();
  }
}, 30_000);


it.skipIf(process.platform === 'win32')('cancels a stalled handshake and closes its socket', async () => {
  const root = mkdtempSync(join(tmpdir(), 'owner-cancel-'));
  roots.push(root);
  const { keyring } = await fixtureKeyring();
  const owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  const directory = join(root, ID);
  mkdirSync(directory, { mode: 0o700 });
  const generation = 'A'.repeat(22);
  const startedAt = readProcessStartTime(process.pid);
  if (startedAt === undefined) throw new Error('Cannot establish process identity');
  writeFileSync(join(directory, 'state.json'), JSON.stringify({ id: ID, pid: process.pid, startedAt, generation }), { mode: 0o600 });
  const socketPath = join(root, `${createHash('sha256').update(ID).digest('hex').slice(0, 16)}.sock`);
  const aborter = new AbortController();
  let peerClosed!: () => void;
  const closed = new Promise<void>((resolve) => { peerClosed = resolve; });
  const server = createServer((peer) => {
    peer.once('close', peerClosed);
    peer.once('data', () => aborter.abort());
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    await expect(openRegisteredOwnerLink({ root, id: ID, generation, handover: owner, signal: aborter.signal })).rejects.toThrow();
    await closed;
  } finally {
    owner.dispose();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 10_000);
