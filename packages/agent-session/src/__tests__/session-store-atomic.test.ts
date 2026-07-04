/**
 * CORE-019 — SessionStore atomic persistence tests.
 *
 * save() must write via a same-directory temp file + rename so a crash mid-write can
 * never leave a truncated/corrupt JSON in place of the previous record. Observable
 * contract pinned here: (1) roundtrip integrity, (2) no temp-file residue after save,
 * (3) a failure before the write completes leaves the previous record untouched.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionStore } from '../session-store.js';

import type { ISessionRecord } from '../session-store.js';

let baseDir: string;

function createRecord(overrides: Partial<ISessionRecord> = {}): ISessionRecord {
  return {
    id: 'core-019-atomic',
    cwd: '/tmp',
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    messages: [{ role: 'user', content: 'original' }],
    ...overrides,
  };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'robota-store-'));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe('SessionStore atomic persistence (CORE-019)', () => {
  it('save() roundtrips and leaves no temp-file residue', () => {
    const store = new SessionStore(baseDir);
    store.save(createRecord());

    const loaded = store.load('core-019-atomic');
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'original' }]);

    const files = readdirSync(baseDir);
    expect(files).toEqual(['core-019-atomic.json']);
  });

  it('save() over an existing record replaces it atomically', () => {
    const store = new SessionStore(baseDir);
    store.save(createRecord());
    store.save(createRecord({ messages: [{ role: 'user', content: 'updated' }] }));

    const raw = readFileSync(join(baseDir, 'core-019-atomic.json'), 'utf-8');
    expect(JSON.parse(raw).messages).toEqual([{ role: 'user', content: 'updated' }]);
    expect(readdirSync(baseDir)).toEqual(['core-019-atomic.json']);
  });

  it('a failed save leaves the previous record untouched', () => {
    const store = new SessionStore(baseDir);
    store.save(createRecord());

    // Fault injection: a circular record makes JSON.stringify throw before any bytes
    // reach the destination file — the previous record must survive.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => store.save(createRecord({ messages: [circular] }))).toThrow();

    const loaded = store.load('core-019-atomic');
    expect(loaded?.messages).toEqual([{ role: 'user', content: 'original' }]);
    expect(readdirSync(baseDir)).toEqual(['core-019-atomic.json']);
  });
});
