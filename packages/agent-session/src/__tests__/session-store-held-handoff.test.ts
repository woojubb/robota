/**
 * A fork record handed to a subagent process (#3679 step 3b, secure conversation).
 *
 * A subagent child holds only a write grant, so it can never open a sealed fork record; the parent
 * hands over the record it holds. These pin the store side of that handoff: a fork write is kept
 * apart from the sessions the store runs (so it never evicts one, and survives many saves), it is
 * handed over once and only while the file is still those bytes, a probe while unlocked holds
 * nothing, and the child's store takes the token and goes on saving the session — never a store that
 * would write it in plaintext.
 */

import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { loadSessionForUpdate } from '../load-session-for-update.js';
import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-fork-handoff-4d1c-conversation-text';
const HELD_LIMIT = 32;

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'held-handoff-')));
}

function record(id: string, text = CANARY): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

const sessionIds = (count: number, prefix = 'sess_held'): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}_${index}`);

function tokenText(token: string): string {
  const [, , , encoded] = token.split('.');
  return Buffer.from(encoded ?? '', 'base64url').toString('utf8');
}

describe('a fork record written for a handoff', () => {
  it('never pushes a held session out of what the store holds', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    const held = sessionIds(HELD_LIMIT);
    for (const id of held) store.save(record(id));

    store.save(record('sess_fork'), { handoff: true });
    sealer.lock();

    for (const id of held) expect(store.loadHeld?.(id)?.status, id).toBe('valid');
  });

  it('is still handed back to a writer after many other sessions were saved', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = new NodeSessionStore(dir, { sealing: { sealer } });

    store.save(record('sess_fork'), { handoff: true });
    for (const id of sessionIds(40, 'sess_other')) store.save(record(id));

    const outcome = loadSessionForUpdate(store, 'sess_fork');
    expect(outcome.status).toBe('valid');
    if (outcome.status === 'valid') {
      expect(JSON.stringify(outcome.record.messages)).toContain(CANARY);
    }
    // Handed back for an update, it is a session this store now runs: the save goes ahead.
    expect(() => store.save(record('sess_fork', 'the next turn'))).not.toThrow();
  });

  it('is exported once, as a token naming the sealed bytes, while the file is still those bytes', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_fork'), { handoff: true });

    const token = store.exportHeld?.('sess_fork');

    expect(token).toMatch(/^rsh2\.unverified\.[0-9a-f]{64}\.[A-Za-z0-9_-]+$/);
    expect(tokenText(token as string)).toContain(CANARY);
    // Consumed: with the keys locked there is nothing left to hand over.
    expect(store.exportHeld?.('sess_fork')).toBeUndefined();
  });

  it('is left in place by an export that keeps it, for the export that hands it over', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_fork'), { handoff: true });

    const kept = [1, 2].map(() => store.exportHeld?.('sess_fork', { keep: true }));
    const handed = store.exportHeld?.('sess_fork');

    expect(kept[0]).toMatch(/^rsh2\./);
    expect(kept).toEqual([handed, handed]);
    expect(store.exportHeld?.('sess_fork', { keep: true })).toBeUndefined();
  });

  it('is not exported once the file changed since the handoff write', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_fork'), { handoff: true });
    // Another writer rewrites the fork (the child running it, say).
    new NodeSessionStore(dir, { sealing: { sealer } }).save(
      record('sess_fork', 'rewritten elsewhere'),
    );
    sealer.lock();

    expect(store.exportHeld?.('sess_fork')).toBeUndefined();
  });
});

describe('exporting a record the store does not hold', () => {
  it('opens the file while unlocked and holds nothing it read', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_fork'));
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    const held = sessionIds(HELD_LIMIT);
    for (const id of held) store.save(record(id));
    const others = sessionIds(5, 'sess_probe');
    for (const id of others) {
      new NodeSessionStore(dir, { sealing: { sealer } }).save(record(id));
    }

    const token = store.exportHeld?.('sess_fork');
    for (const id of others) expect(store.exportHeld?.(id)).toMatch(/^rsh2\./);
    sealer.lock();

    expect(tokenText(token as string)).toContain(CANARY);
    expect(store.loadHeld?.('sess_fork')).toBeUndefined();
    for (const id of held) expect(store.loadHeld?.(id)?.status, id).toBe('valid');
  });

  it('is nothing while the keys are locked, and nothing for a store that seals nothing', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_fork'));
    sealer.lock();

    expect(
      new NodeSessionStore(dir, { sealing: { sealer } }).exportHeld?.('sess_fork'),
    ).toBeUndefined();

    const plainDir = newStoreDir();
    const plain = new NodeSessionStore(plainDir, { sealing: 'plain' });
    plain.save(record('sess_fork'), { handoff: true });
    expect(plain.exportHeld?.('sess_fork')).toBeUndefined();
    // A plain handoff write is the plain file.
    expect(readFileSync(path.join(plainDir, 'sess_fork.json'), 'utf8')).toContain(CANARY);
  });
});

describe('a store that holds only a write grant', () => {
  it('reports a sealed record as no keys here, not as locked keys an unlock would open', () => {
    const dir = newStoreDir();
    const parent = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer: parent } }).save(record('sess_fork'));
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(parent.writeGrant()) },
    });

    expect(child.load('sess_fork')).toEqual({ status: 'locked', reason: 'no-keys' });
  });

  it('takes the handed-over record, resumes it and keeps saving it sealed', () => {
    const dir = newStoreDir();
    const parentSealer = createTestArtifactSealer({ locked: true });
    const parent = new NodeSessionStore(dir, { sealing: { sealer: parentSealer } });
    parent.save(record('sess_fork'), { handoff: true });
    const token = parent.exportHeld?.('sess_fork') as string;
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(parentSealer.writeGrant()) },
    });

    child.importHeld?.('sess_fork', token);
    const outcome = loadSessionForUpdate(child, 'sess_fork');
    child.save(record('sess_fork', 'the child turn'));

    expect(outcome.status).toBe('valid');
    if (outcome.status === 'valid') {
      expect(JSON.stringify(outcome.record.messages)).toContain(CANARY);
    }
    expect(readFileSync(path.join(dir, 'sess_fork.json'), 'utf8')).not.toContain('the child turn');
    parentSealer.unlock();
    const reread = parent.load('sess_fork');
    expect(reread.status).toBe('valid');
    if (reread.status === 'valid') {
      expect(JSON.stringify(reread.record.messages)).toContain('the child turn');
    }
  });

  it('does not take a record for a file that is no longer the bytes the token names', () => {
    const dir = newStoreDir();
    const parentSealer = createTestArtifactSealer();
    const parent = new NodeSessionStore(dir, { sealing: { sealer: parentSealer } });
    parent.save(record('sess_fork'));
    const token = parent.exportHeld?.('sess_fork') as string;
    parent.save(record('sess_fork', 'rewritten after the export'));
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(parentSealer.writeGrant()) },
    });

    child.importHeld?.('sess_fork', token);

    expect(loadSessionForUpdate(child, 'sess_fork')).toEqual({
      status: 'locked',
      reason: 'changed',
    });
  });

  it.each<[string, (token: string) => string]>([
    ['a token this build does not issue', () => 'rsh1.abc.def'],
    [
      'a token that does not say whose the record was',
      (token) => token.replace(/^rsh2\.[a-z]+\./, 'rsh2.'),
    ],
    [
      'a digest that is not one',
      (token) => token.replace(/^(rsh2\.[a-z]+\.)[0-9a-f]{4}/, '$1zzzz'),
    ],
    ['a non-canonical encoding', (token) => `${token}=`],
    ['another session’s record', (token) => token],
  ])('refuses %s', (label, mutate) => {
    const dir = newStoreDir();
    const parentSealer = createTestArtifactSealer();
    const parent = new NodeSessionStore(dir, { sealing: { sealer: parentSealer } });
    parent.save(record('sess_other'));
    const token = mutate(parent.exportHeld?.('sess_other') as string);
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(parentSealer.writeGrant()) },
    });

    expect(() => child.importHeld?.('sess_fork', token), label).toThrow(TypeError);
  });

  it('is refused by a store that seals nothing, which would write the record in plaintext', () => {
    const dir = newStoreDir();
    const parentSealer = createTestArtifactSealer();
    const parent = new NodeSessionStore(dir, { sealing: { sealer: parentSealer } });
    parent.save(record('sess_fork'));
    const token = parent.exportHeld?.('sess_fork') as string;
    const plain = new NodeSessionStore(dir, { sealing: 'plain' });

    expect(() => plain.importHeld?.('sess_fork', token)).toThrow(TypeError);
    expect(() => plain.save(record('sess_fork', 'plaintext'))).toThrow();
  });
});
