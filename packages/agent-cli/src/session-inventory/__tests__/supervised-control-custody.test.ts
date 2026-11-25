/**
 * A secure runtime's control endpoint serving its custody: what an admitted owner's `control`
 * request is answered with from the runtime's own state, the daemon role the owner takes through it,
 * and the open `lock` command, which needs no proof. The custody's own rules are the local host's
 * tests; here the endpoint is the product's real one, on a real socket, with the real link clients.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createRuntimeIdentity,
  openOwnerHandover,
  startSpawnerExchange,
  type IOwnerHandover,
} from '@robota-sdk/agent-keyring';
import { KeyHolder, RuntimeCustody, type TLockReason } from '@robota-sdk/agent-local-host';
import {
  openOwnerLink,
  openSpawnerLink,
  type IOwnerRuntimeLinkClient,
} from '@robota-sdk/agent-transport/link';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from '../../secure/__tests__/helpers.js';
import { startSupervisedControl, type ISupervisedControl } from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

let owner: IOwnerHandover;

beforeAll(async () => {
  const { keyring } = await fixtureKeyring();
  owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
});
afterAll(() => owner.dispose());

const scratch: string[] = [];
const controls: ISupervisedControl[] = [];
const sockets: Socket[] = [];
const clients: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const control of controls.splice(0)) await control.close();
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface IStarted {
  readonly root: string;
  readonly socketPath: string;
  readonly custody: RuntimeCustody;
  readonly locks: TLockReason[];
  readonly rename: ReturnType<typeof vi.fn>;
}

/** A runtime whose spawner has certified it for the owner, behind the product's control endpoint. */
async function certified(): Promise<IStarted> {
  const directory = mkdtempSync(join(tmpdir(), 'rs-custody-'));
  scratch.push(directory);
  const root = join(directory, 'supervised');
  const identity = createRuntimeIdentity();
  const exchange = startSpawnerExchange();
  const { spawnerKey, instancePublicKey } = exchange.complete(
    identity.answerSpawnerExchange(exchange.message),
  );
  const { keyring } = await fixtureKeyring();
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  const locks: TLockReason[] = [];
  holder.onLock((reason) => locks.push(reason));
  const custody = new RuntimeCustody({ identity, holder, attachTarget: { session: {} as never } });
  const rename = vi.fn();
  controls.push(
    await startSupervisedControl({
      id: ID,
      root,
      onStop: () => undefined,
      observe: { activity: () => 'idle', name: () => 'Morning review' },
      rename,
      admission: custody.admission,
    }),
  );
  const socketPath = join(
    root,
    readdirSync(root).find((name) => name.endsWith('.sock'))!,
  );
  const socket = await connectTo(socketPath);
  const spawner = await openSpawnerLink(socket, spawnerKey, instancePublicKey);
  clients.push(spawner);
  await spawner.installTrustRoot(owner.certify(spawner.instancePublicKey, spawner.binding));
  await spawner.closed;
  // The client may observe its close before the runtime processes its end of the link.
  await vi.waitFor(() => expect(custody.spawnerLinks()).toBe(0));
  return { root, socketPath, custody, locks, rename };
}

async function connectTo(socketPath: string): Promise<Socket> {
  const socket = createConnection(socketPath);
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  return socket;
}

async function ownerLink(started: IStarted): Promise<IOwnerRuntimeLinkClient> {
  const client = await openOwnerLink(await connectTo(started.socketPath), owner);
  clients.push(client);
  return client;
}

describe.skipIf(process.platform === 'win32')(
  'a certified runtime behind its control endpoint',
  () => {
    it('runs the owner commands through the plain socket handler, with the whole status', async () => {
      const started = await certified();
      const client = await ownerLink(started);

      expect(await client.control({ command: 'status', fields: {} })).toMatchObject({
        status: 'running',
        name: 'Morning review',
        certified: true,
      });
      expect(
        await client.control({ command: 'rename', fields: { name: 'Evening review' } }),
      ).toEqual({
        status: 'renamed',
      });
      expect(started.rename).toHaveBeenCalledExactlyOnceWith('Evening review');
      for (const command of ['stop', 'lock', 'connect', 'link', 'nope']) {
        expect(await client.control({ command, fields: {} })).toEqual({ status: 'refused' });
      }
    });

    it('is made its workspace daemon by its owner, and says so in the open status', async () => {
      const started = await certified();
      const client = await ownerLink(started);

      expect(await client.control({ command: 'take-daemon-role', fields: {} })).toEqual({
        status: 'daemon',
      });

      expect(started.custody.status().daemon).toBe(true);
    });

    it('locks on the open lock command, which needs no proof, and tells the links', async () => {
      const started = await certified();
      const client = await ownerLink(started);
      await client.unlock();

      const socket = await connectTo(started.socketPath);
      socket.setEncoding('utf8');
      const generation = (
        JSON.parse(readFileSync(join(started.root, ID, 'state.json'), 'utf8')) as {
          generation: string;
        }
      ).generation;
      socket.write(`${JSON.stringify({ command: 'lock', id: ID, generation })}\n`);
      await new Promise<void>((resolve) => socket.once('data', () => resolve()));

      expect(started.locks).toEqual(['explicit']);
      await vi.waitFor(() => expect(client.custody.unlocked).toBe(false));
    });
  },
);
