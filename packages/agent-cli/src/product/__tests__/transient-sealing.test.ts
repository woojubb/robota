/**
 * #3679 step 3c — how a process seals what only it reads back: its spilled tool results (and, next,
 * its ephemeral checkpoints). It is the same decision as every store's: plain exactly while the
 * session stores are plain, so nothing changes until secure conversation is switched on. When the
 * process seals, it seals these with ONE process-local key, made the first time it is needed and
 * shared by every store the runtime builds — not the keyring's, so a process whose keys are locked
 * still reads back the tool result its own turn spilled a moment ago.
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROCESS_OWNER_RECORD_NAME } from '@robota-sdk/agent-core/node';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { ProcessLocalArtifactSealer } from '../../secure/artifact-sealer.js';
import { KeyHolder } from '../../secure/key-holder.js';
import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from '../../secure/__tests__/helpers.js';
import {
  createProductWorkerSealing,
  overrideProductSecureMode,
  resolveProductSessionSealing,
  resolveProductTransientSealing,
  useProductKeyHolder,
} from '../session-sealing.js';
import { createProductToolResultSpillStore } from '../session-stores.js';

import type { TProductTransientSealing } from '../session-sealing.js';

const CANARY = 'CANARY-transient-91fe-spilled-text';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function home(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'product-transient-sealing-')));
  roots.push(dir);
  return dir;
}

async function lockedHolder(): Promise<KeyHolder> {
  const { keyring } = await fixtureKeyring();
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  holder.lock('explicit');
  return holder;
}

function spilledFiles(userHome: string): string[] {
  const parent = join(userHome, '.test-product', 'spill');
  return readdirSync(parent).flatMap((directory) =>
    readdirSync(join(parent, directory))
      .filter((name) => name !== PROCESS_OWNER_RECORD_NAME)
      .map((name) => join(parent, directory, name)),
  );
}

describe('the product transient sealing', () => {
  it('is plain whenever the session sealing is plain', () => {
    const runtime = createTestProductRuntime();
    expect(resolveProductSessionSealing(runtime)).toBe('plain');
    expect(resolveProductTransientSealing(runtime)).toBe('plain');

    const worker = createTestProductRuntime();
    createProductWorkerSealing(worker);
    expect(resolveProductSessionSealing(worker)).toBe('plain');
    expect(resolveProductTransientSealing(worker)).toBe('plain');
  });

  it('is one process-local sealer per runtime once the runtime seals, never the keyring’s', async () => {
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, true);
    useProductKeyHolder(runtime, await lockedHolder());

    const first = resolveProductTransientSealing(runtime);
    const second = resolveProductTransientSealing(runtime);
    if (first === 'plain' || second === 'plain') throw new Error('expected a sealing');
    expect(first.sealer).toBeInstanceOf(ProcessLocalArtifactSealer);
    expect(second.sealer).toBe(first.sealer);
    const session = resolveProductSessionSealing(runtime);
    expect(session === 'plain' ? undefined : session.sealer).not.toBe(first.sealer);

    const other = createTestProductRuntime();
    overrideProductSecureMode(other, true);
    useProductKeyHolder(other, await lockedHolder());
    const elsewhere = resolveProductTransientSealing(other);
    expect(elsewhere === 'plain' ? undefined : elsewhere.sealer).not.toBe(first.sealer);

    // The type admits the process-local sealer only, so the keyring's cannot stand in for it.
    const transient: TProductTransientSealing = first;
    // @ts-expect-error -- a keyring sealer is not a process-local one
    const keyring: TProductTransientSealing = session;
    expect(keyring).not.toBe(transient);
  });

  it('builds a spill store that reads back what it sealed while the keys are locked', async () => {
    const userHome = home();
    const runtime = createTestProductRuntime('test-product', { HOME: userHome });
    const holder = await lockedHolder();
    overrideProductSecureMode(runtime, true);
    useProductKeyHolder(runtime, holder);

    const store = createProductToolResultSpillStore(runtime);
    const { reference } = await store.write(CANARY);
    expect(holder.isUnlocked).toBe(false);
    expect(await store.read(reference)).toBe(CANARY);

    const [file, ...more] = spilledFiles(userHome);
    expect(more).toEqual([]);
    expect(file).toMatch(/\.sealed$/u);
    expect(readFileSync(file!).subarray(0, 4).toString('latin1')).toBe('RSL1');
    expect(readFileSync(file!).includes(Buffer.from(CANARY))).toBe(false);
    await store.shutdown();
  });

  it('builds a spill store that writes what every earlier build wrote while the runtime is plain', async () => {
    const userHome = home();
    const store = createProductToolResultSpillStore(
      createTestProductRuntime('test-product', { HOME: userHome }),
    );
    const { reference } = await store.write(CANARY);

    const [file, ...more] = spilledFiles(userHome);
    expect(more).toEqual([]);
    expect(file).toMatch(/\/[A-Za-z0-9_-]{24}\.txt$/u);
    expect(readFileSync(file!, 'utf8')).toBe(CANARY);
    expect(await store.read(reference)).toBe(CANARY);
    await store.shutdown();
  });
});
