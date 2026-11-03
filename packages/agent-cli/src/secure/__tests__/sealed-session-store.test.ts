/**
 * The session store over the PRODUCTION sealer: a real keyring, a real KeyHolder, real files.
 *
 * The store's own cases run against a test double in agent-session; this is the join the product
 * relies on once secure mode is on — a locked process writing a session with only the public key,
 * another process (or the same one after an unlock) reading it, and the store saying "locked"
 * instead of "missing" or "corrupt" in between.
 */
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeHostSessionStore, createUserSessionStore } from '@robota-sdk/agent-framework';
import { SealedSessionUnreadableError } from '@robota-sdk/agent-session';
import { describe, expect, it } from 'vitest';

import { KeyHolderArtifactSealer } from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { FIXTURE_PASSPHRASE, createMemoryKeyringStore, fixtureKeyring } from './helpers.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-e60a-the-prompt-the-user-typed';

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: CANARY,
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

async function holder(): Promise<KeyHolder> {
  const { keyring } = await fixtureKeyring();
  return new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
}

const unlock = (target: KeyHolder) =>
  target.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });

describe('sessions sealed with the keyring', () => {
  it('lets a process that never unlocked write a session that an unlocked one reads', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sealed-real-')));
    const writerHolder = await holder();
    const writer = createNodeHostSessionStore(dir, {
      sealing: { sealer: new KeyHolderArtifactSealer(writerHolder) },
    });

    writer.save(record('sess_a'));
    const bytes = readFileSync(join(dir, 'sess_a.json'));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(bytes.includes(Buffer.from(CANARY))).toBe(false);
    // Locked here: present, not missing and not corrupt.
    expect(writer.load('sess_a')).toEqual({ status: 'locked' });

    const readerHolder = await holder();
    await unlock(readerHolder);
    const reader = createNodeHostSessionStore(dir, {
      sealing: { sealer: new KeyHolderArtifactSealer(readerHolder) },
    });
    expect(reader.load('sess_a')).toEqual({ status: 'valid', record: record('sess_a') });
    expect(reader.list().map((entry) => entry.id)).toEqual(['sess_a']);
    expect(reader.scan?.().locked).toBe(0);
  });

  it('goes locked when the holder locks, lists nothing, counts the sessions and reads again after the unlock', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sealed-real-')));
    const keys = await holder();
    await unlock(keys);
    const store = createUserSessionStore(join(dir, 'sessions'), {
      sealing: { sealer: new KeyHolderArtifactSealer(keys) },
    });
    store.save(record('sess_a'));
    store.save(record('sess_b'));
    expect(store.list()).toHaveLength(2);

    keys.lock('idle');
    expect(store.load('sess_a')).toEqual({ status: 'locked' });
    expect(store.list()).toEqual([]);
    expect(store.scan?.().locked).toBe(2);

    await unlock(keys);
    expect(store.list()).toHaveLength(2);
    expect(store.scan?.().locked).toBe(0);
  });

  it('keeps saving the sessions it holds while locked, and refuses one it never held', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sealed-real-')));
    const keys = await holder();
    await unlock(keys);
    const store = createNodeHostSessionStore(dir, {
      sealing: { sealer: new KeyHolderArtifactSealer(keys) },
    });
    store.save(record('sess_a'));
    keys.lock('explicit');
    const before = readFileSync(join(dir, 'sess_a.json'));

    // The process that wrote it goes on saving it: sealing needs only the public key.
    expect(() =>
      store.save({ ...record('sess_a'), updatedAt: '2026-08-02T00:00:00.000Z' }),
    ).not.toThrow();
    const after = readFileSync(join(dir, 'sess_a.json'));
    expect(after.equals(before)).toBe(false);
    expect(after.includes(Buffer.from(CANARY))).toBe(false);

    // A restarted process remembers nothing about it, and replaces nothing it cannot open.
    const restarted = createNodeHostSessionStore(dir, {
      sealing: { sealer: new KeyHolderArtifactSealer(keys) },
    });
    expect(() => restarted.save(record('sess_a'))).toThrow(SealedSessionUnreadableError);
    expect(readFileSync(join(dir, 'sess_a.json')).equals(after)).toBe(true);
    // A session that is new to the store is written as usual.
    expect(() => restarted.save(record('sess_new'))).not.toThrow();

    await unlock(keys);
    const reread = store.load('sess_a');
    if (reread.status !== 'valid') throw new Error(`expected valid, got ${reread.status}`);
    expect(reread.record.updatedAt).toBe('2026-08-02T00:00:00.000Z');
  });
});
