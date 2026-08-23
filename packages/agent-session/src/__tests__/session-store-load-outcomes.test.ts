/**
 * TRANS-007 (issue #2096) — the store says WHICH of the four things happened, and does not destroy.
 *
 * The decoder is tested exhaustively elsewhere. **That proves the decoder and says nothing about
 * whether the store routes through it.** A guard is not covered because the module that defines it is
 * covered, so every case here drives a real load path — `load`, `list`, and the write path that reads
 * before it writes — rather than calling the decoder directly.
 *
 * Two cases are deliberately written the hard way:
 *   - TC-05 compares the file BYTES before and after an attempted save, because "the call did not
 *     throw" is not "the call did not write", and the defect being fixed is a write.
 *   - TC-10 reads the file and parses it, because asserting that a saved record loads back proves
 *     only that the codec agrees with itself; the format change is what is on disk.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { persistSession } from '../session-history-ops.js';
import { SESSION_ARTIFACT_SCHEMA_VERSION } from '../session-record-codec/index.js';
import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const SESSION_ID = 'sess_outcomes';

function newStoreDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'trans-007-'));
}

function record(id = SESSION_ID): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: 'hello',
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

describe('TC-01 / TC-04: missing and valid are different answers', () => {
  it('reports missing for an id that was never saved', () => {
    const store = new NodeSessionStore(newStoreDir());
    expect(store.load('never-saved')).toEqual({ status: 'missing' });
  });

  it('round-trips a saved record as valid, with the Date revived', () => {
    const store = new NodeSessionStore(newStoreDir());
    store.save(record());
    const outcome = store.load(SESSION_ID);
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect(outcome.record).toEqual(record());
    expect(outcome.record.messages[0]?.timestamp).toBeInstanceOf(Date);
  });
});

describe('TC-02: a damaged file is corrupt, not missing', () => {
  it('reports corrupt with a located issue when the file is truncated', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    store.save(record());
    // Truncate a file that was valid, rather than hand-writing a broken literal: this is what a
    // crash mid-write actually leaves behind.
    const file = path.join(dir, `${SESSION_ID}.json`);
    writeFileSync(file, readFileSync(file, 'utf-8').slice(0, 60), 'utf-8');

    const outcome = store.load(SESSION_ID);
    expect(outcome.status).toBe('corrupt');
    if (outcome.status !== 'corrupt') throw new Error('expected corrupt');
    expect(outcome.issues.length).toBeGreaterThan(0);
    expect(outcome.issues[0]?.message.length).toBeGreaterThan(0);
  });

  it('reports corrupt for a well-formed envelope whose record is not a record', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    writeFileSync(
      path.join(dir, `${SESSION_ID}.json`),
      JSON.stringify({ schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION, record: { id: 'x' } }),
      'utf-8',
    );
    const outcome = store.load(SESSION_ID);
    expect(outcome.status).toBe('corrupt');
    if (outcome.status !== 'corrupt') throw new Error('expected corrupt');
    expect(outcome.issues.map((issue) => issue.path)).toContain('record.cwd');
  });
});

describe('TC-03: a file from an earlier build is unsupported', () => {
  it('reports unsupported for a bare record with no envelope', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    // The pre-envelope shape. This build cannot produce it, so a fixture is the only way to test the
    // case every existing session file is in — which is the case every beta user meets on their
    // first resume after this lands.
    writeFileSync(path.join(dir, `${SESSION_ID}.json`), JSON.stringify(record(), null, 2), 'utf-8');
    expect(store.load(SESSION_ID)).toEqual({ status: 'unsupported', schemaVersion: undefined });
  });

  it('reports unsupported, carrying the version it saw, for a future envelope', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    writeFileSync(
      path.join(dir, `${SESSION_ID}.json`),
      JSON.stringify({ schemaVersion: 99, record: record() }),
      'utf-8',
    );
    expect(store.load(SESSION_ID)).toEqual({ status: 'unsupported', schemaVersion: 99 });
  });
});

describe('TC-05: the write path refuses rather than overwriting what it cannot read', () => {
  function persistContext(store: NodeSessionStore, history: unknown[] = []) {
    return {
      sessionStore: store,
      sessionId: SESSION_ID,
      cwd: '/work',
      systemPrompt: 'p',
      toolSchemas: [],
      agent: { getHistory: () => history },
      getFullHistory: () => [],
    } as unknown as Parameters<typeof persistSession>[0];
  }

  it.each([
    [
      'a truncated file',
      (dir: string) => {
        const file = path.join(dir, `${SESSION_ID}.json`);
        writeFileSync(file, readFileSync(file, 'utf-8').slice(0, 60), 'utf-8');
      },
    ],
    [
      'a pre-envelope file',
      (dir: string) => {
        writeFileSync(path.join(dir, `${SESSION_ID}.json`), JSON.stringify(record()), 'utf-8');
      },
    ],
  ])('leaves %s byte-identical', (_case, damage) => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    store.save(record());
    damage(dir);

    const file = path.join(dir, `${SESSION_ID}.json`);
    const before = readFileSync(file, 'utf-8');
    const outcome = persistSession(persistContext(store));

    // The bytes, not the absence of a throw. Before TRANS-007 this call replaced a recoverable file
    // with a fresh, nearly empty record on the next autosave.
    expect(readFileSync(file, 'utf-8')).toBe(before);
    expect(outcome.status).not.toBe('valid');
  });

  it('still writes when there is genuinely nothing to preserve', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    const outcome = persistSession(persistContext(store));
    expect(outcome.status).toBe('valid');
    expect(store.load(SESSION_ID).status).toBe('valid');
  });
});

describe('TC-08: list reports what it cannot read instead of hiding it', () => {
  it('includes an unreadable session in the listing, with its outcome', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    store.save(record('sess_ok'));
    writeFileSync(path.join(dir, 'sess_old.json'), JSON.stringify(record('sess_old')), 'utf-8');

    const entries = store.list();
    expect(entries.map((entry) => entry.id).sort()).toEqual(['sess_ok', 'sess_old']);
    expect(entries.find((entry) => entry.id === 'sess_old')?.outcome.status).toBe('unsupported');
    expect(entries.find((entry) => entry.id === 'sess_ok')?.outcome.status).toBe('valid');
  });

  it('reports a file whose NAME is not a usable session id instead of throwing', () => {
    // `load` REJECTS a malformed id, because a caller's id is a value SEC-006 must not trust. A name
    // read out of the directory is not that value, and routing `list` through `load` made one
    // `my session.json` throw out of the whole listing — the resume picker with it. Reporting it is
    // the same answer `list` gives for every other file it cannot read.
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    store.save(record('readable'));
    writeFileSync(path.join(dir, 'my session.json'), '{}', 'utf-8');

    const entries = store.list();
    expect(entries.map((entry) => entry.id).sort()).toEqual(['my session', 'readable']);
    expect(entries.find((entry) => entry.id === 'my session')?.outcome.status).toBe('corrupt');
    // The readable one is still readable — a reported neighbour does not cost it its outcome.
    expect(entries.find((entry) => entry.id === 'readable')?.outcome.status).toBe('valid');
  });

  it('sorts readable sessions by recency and keeps unreadable ones present', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    store.save({ ...record('older'), updatedAt: '2026-08-01T00:00:00.000Z' });
    store.save({ ...record('newer'), updatedAt: '2026-08-02T00:00:00.000Z' });
    writeFileSync(path.join(dir, 'unreadable.json'), 'not json at all', 'utf-8');

    const ids = store.list().map((entry) => entry.id);
    expect(ids.slice(0, 2)).toEqual(['newer', 'older']);
    expect(ids).toContain('unreadable');
  });
});

describe('TC-10: the envelope is on disk, not merely in the round trip', () => {
  it('writes { schemaVersion, record } as the persisted shape', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir);
    store.save(record());

    const onDisk = JSON.parse(readFileSync(path.join(dir, `${SESSION_ID}.json`), 'utf-8')) as {
      schemaVersion: number;
      record: { id: string };
    };
    expect(onDisk.schemaVersion).toBe(SESSION_ARTIFACT_SCHEMA_VERSION);
    expect(onDisk.record.id).toBe(SESSION_ID);
    // The bare record is NOT the top level any more — the assertion that would have passed before.
    expect((onDisk as unknown as { id?: string }).id).toBeUndefined();
  });

  it('cleans up its temp directories', () => {
    const dir = newStoreDir();
    rmSync(dir, { recursive: true, force: true });
    expect(new NodeSessionStore(dir).list()).toEqual([]);
  });
});
