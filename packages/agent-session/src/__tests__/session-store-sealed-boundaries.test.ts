/**
 * Sealed session records at the edges of what a store may conclude (#3679, secure conversation).
 *
 * A file the same OS user can write may hold ciphertext but is never a trust anchor, so each case
 * here asks one question a store must answer without guessing: what it remembers and when, what it
 * does with a file it could not read or does not understand, whose record a file holds, and what it
 * pays for the answer. Every case drives the real store over a real directory.
 */

import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { SESSION_RECORD_ENVELOPE_VERSION } from '../session-record-codec/index.js';
import { NodeSessionStore } from '../session-store.js';
import { SealedSessionUnreadableError } from '../stored-session-record.js';

import type { IArtifactContext, IArtifactSealer } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-41f0d2-held-conversation';

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'sealed-boundaries-')));
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

const fileOf = (dir: string, id: string): string => path.join(dir, `${id}.json`);

function plainEnvelope(value: IInteractiveSessionRecord): string {
  return JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: value }, null, 2);
}

function thrownBy(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A sealer that counts how often it is asked to open something, and keeps what it handed back. */
function countingSealer(inner: IArtifactSealer = createTestArtifactSealer()) {
  const opened: Uint8Array[] = [];
  const sealer: IArtifactSealer = {
    ...inner,
    openBytes(stored: Uint8Array, context: IArtifactContext) {
      const plain = inner.openBytes(stored, context);
      opened.push(plain);
      return plain;
    },
  };
  return { sealer, opened };
}

describe('a store holds a session only when it wrote it or was asked to hold it', () => {
  it('keeps saving a session it holds while locked, however many other sessions were probed', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_live'));
    const other = new NodeSessionStore(dir, { sealing: { sealer } });
    for (let index = 0; index < 40; index += 1) other.save(record(`sess_other_${index}`));
    // Read-only probes: a usage report, an "is it locked?" check, a fork attach.
    for (let index = 0; index < 40; index += 1) {
      expect(store.load(`sess_other_${index}`).status).toBe('valid');
    }
    sealer.lock();

    expect(thrownBy(() => store.save(record('sess_live', 'after the lock')))).toBeUndefined();
    sealer.unlock();
    expect(store.load('sess_live')).toEqual({
      status: 'valid',
      record: record('sess_live', 'after the lock'),
    });
  });

  it('does not hold what a probe read, so it cannot replace that session once the keys lock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_a'));
    const prober = new NodeSessionStore(dir, { sealing: { sealer } });
    expect(prober.load('sess_a').status).toBe('valid');
    sealer.lock();
    const before = readFileSync(fileOf(dir, 'sess_a'));

    expect(thrownBy(() => prober.save(record('sess_a', 'x')))).toBeInstanceOf(
      SealedSessionUnreadableError,
    );
    expect(prober.loadHeld('sess_a')).toBeUndefined();
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });

  it('holds a session a resume-style load asked for, and keeps saving it after the lock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_a'));
    const resumer = new NodeSessionStore(dir, { sealing: { sealer } });
    expect(resumer.load('sess_a', { hold: true }).status).toBe('valid');
    sealer.lock();

    expect(resumer.loadHeld('sess_a')).toEqual({ status: 'valid', record: record('sess_a') });
    resumer.save(record('sess_a', 'after the lock'));
    sealer.unlock();
    expect(resumer.load('sess_a')).toEqual({
      status: 'valid',
      record: record('sess_a', 'after the lock'),
    });
  });

  it('wipes the plaintext the sealer handed back once it is decoded', () => {
    const dir = newStoreDir();
    const { sealer, opened } = countingSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    new NodeSessionStore(dir, { sealing: { sealer } }).load('sess_a', { hold: true });

    expect(opened).toHaveLength(1);
    expect(opened[0]!.length).toBeGreaterThan(0);
    expect(opened[0]!.every((byte) => byte === 0)).toBe(true);
  });
});

describe('a store pays for what it already knows only once', () => {
  it('replaces a file it remembers without decrypting it first', () => {
    const dir = newStoreDir();
    const { sealer, opened } = countingSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    store.save(record('sess_a', 'second'));
    store.save(record('sess_a', 'third'));

    expect(opened).toHaveLength(0);
  });

  it('scans once for both the readable list and how many sessions are locked', () => {
    const dir = newStoreDir();
    const inner = createTestArtifactSealer();
    const { sealer, opened } = countingSealer(inner);
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    writeFileSync(fileOf(dir, 'sess_plain'), plainEnvelope(record('sess_plain')), 'utf-8');
    store.save(record('sess_sealed'));
    new NodeSessionStore(dir, { sealing: { sealer: inner } }).save(record('sess_open'));
    inner.lock();

    const scan = store.scan();

    expect(scan.locked).toBe(2);
    expect(scan.entries.map((entry) => [entry.id, entry.outcome.status])).toEqual([
      ['sess_plain', 'valid'],
    ]);
    // One attempt per sealed file, not one for the list and another for the count.
    expect(opened).toHaveLength(0);
    inner.unlock();
    const unlocked = store.scan();
    expect(unlocked.locked).toBe(0);
    expect(opened).toHaveLength(2);
  });
});

describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'a session file the store cannot read is not treated as absent',
  () => {
    it('refuses to replace a sealed file it cannot open for reading, with or without a sealer', () => {
      const dir = newStoreDir();
      new NodeSessionStore(dir, {
        sealing: { sealer: createTestArtifactSealer() },
      }).save(record('sess_a'));
      const before = readFileSync(fileOf(dir, 'sess_a'));
      chmodSync(fileOf(dir, 'sess_a'), 0o000);
      try {
        for (const store of [
          new NodeSessionStore(dir, { sealing: 'plain' }),
          new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }),
        ]) {
          const thrown = thrownBy(() => store.save(record('sess_a', 'replacement')));
          expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
          expect((thrown as SealedSessionUnreadableError).reason).toBe('unreadable');
        }
      } finally {
        chmodSync(fileOf(dir, 'sess_a'), 0o600);
      }
      expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
    });
  },
);

describe('a record answers only for the id it is stored under', () => {
  it('reports a plain record copied to another id as corrupt, not as that session', () => {
    const dir = newStoreDir();
    writeFileSync(fileOf(dir, 'sess_b'), plainEnvelope(record('sess_a')), 'utf-8');
    for (const store of [
      new NodeSessionStore(dir, { sealing: 'plain' }),
      new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }),
    ]) {
      const outcome = store.load('sess_b');
      expect(outcome.status).toBe('corrupt');
      expect(JSON.stringify(outcome)).not.toContain(CANARY);
      expect(store.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
        ['sess_b', 'corrupt'],
      ]);
    }
  });

  it('reports a sealed file whose record names another session as corrupt', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    // Sealed to sess_b, so it opens there; the record inside says it is sess_a.
    writeFileSync(
      fileOf(dir, 'sess_b'),
      sealer.sealBytes(Buffer.from(plainEnvelope(record('sess_a'))), {
        kind: 'session-record',
        id: 'sess_b',
      }),
    );
    const store = new NodeSessionStore(dir, { sealing: { sealer } });

    const outcome = store.load('sess_b', { hold: true });

    expect(outcome.status).toBe('corrupt');
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
    sealer.lock();
    expect(store.loadHeld('sess_b')).toBeUndefined();
  });
});

describe('a sealed file in a framing version this build does not know', () => {
  function newerFile(dir: string, id: string): Buffer {
    const bytes = Buffer.concat([Buffer.from('RSL2', 'ascii'), randomBytes(96)]);
    writeFileSync(fileOf(dir, id), bytes);
    return bytes;
  }

  it('is reported as written by a build this one does not read, with or without a sealer', () => {
    const dir = newStoreDir();
    newerFile(dir, 'sess_new');
    for (const store of [
      new NodeSessionStore(dir, { sealing: 'plain' }),
      new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }),
    ]) {
      expect(store.load('sess_new')).toEqual({ status: 'unsupported', schemaVersion: undefined });
      expect(store.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
        ['sess_new', 'unsupported'],
      ]);
    }
  });

  it('is never replaced, with or without a sealer', () => {
    const dir = newStoreDir();
    const before = newerFile(dir, 'sess_new');
    for (const store of [
      new NodeSessionStore(dir, { sealing: 'plain' }),
      new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }),
    ]) {
      const thrown = thrownBy(() => store.save(record('sess_new')));
      expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
      expect((thrown as SealedSessionUnreadableError).reason).toBe('newer-format');
    }
    expect(readFileSync(fileOf(dir, 'sess_new')).equals(before)).toBe(true);
  });
});

describe('the reasons a save is refused say what the store saw', () => {
  it('names a file that changed since this store wrote it as changed', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    sealer.lock();
    writeFileSync(
      fileOf(dir, 'sess_a'),
      sealer.sealBytes(Buffer.from('another writer'), { kind: 'session-record', id: 'sess_a' }),
    );

    const thrown = thrownBy(() => store.save(record('sess_a', 'mine')));

    expect((thrown as SealedSessionUnreadableError).reason).toBe('changed');
    expect((thrown as Error).message).toBe(
      'Session sess_a changed on disk since this process last wrote or read it, so it was not overwritten.',
    );
  });

  it('names a file sealed with other keys as one that does not open, without claiming who wrote it', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
      record('sess_a'),
    );

    const thrown = thrownBy(() =>
      new NodeSessionStore(dir, {
        sealing: { sealer: createTestArtifactSealer() },
      }).save(record('sess_a')),
    );

    expect((thrown as SealedSessionUnreadableError).reason).toBe('does-not-open');
    expect((thrown as Error).message).toBe(
      'Session sess_a holds a sealed record that does not open for this session, so it was not overwritten.',
    );
  });
});

describe('how a store is built', () => {
  it('keeps records plain when it says plain, and refuses a sealing that is missing or is not one', () => {
    const root = newStoreDir();
    const dir = path.join(root, 'sessions');
    // Both call shapes: with and without an owned root.
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record('sess_a'));
    new NodeSessionStore(dir, { ownedRoot: root, sealing: 'plain' }).save(record('sess_b'));
    expect(JSON.parse(readFileSync(fileOf(dir, 'sess_a'), 'utf8')).record.id).toBe('sess_a');
    expect(JSON.parse(readFileSync(fileOf(dir, 'sess_b'), 'utf8')).record.id).toBe('sess_b');

    const Stated = NodeSessionStore as unknown as new (...args: unknown[]) => NodeSessionStore;
    // What the types refuse, a caller that ignores them is refused at run time as well.
    expect(() => new Stated(dir)).toThrow(TypeError);
    expect(() => new Stated(dir, {})).toThrow(TypeError);
    expect(() => new Stated(dir, { sealing: { sealer: undefined } })).toThrow(TypeError);
    expect(() => new Stated(dir, { sealing: 'sealed' })).toThrow(TypeError);
    expect(() => new Stated(dir, 'plain')).toThrow(TypeError);
  });
});
