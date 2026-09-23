/**
 * SEC-006 — a session id is a PATH SEGMENT, and one caller supplies it from an untrusted source.
 *
 * `SessionStore.filePath(id)` is `join(baseDir, `${id}.json`)` with no validation, and
 * `FileSessionLogger.log(sessionId, …)` is `join(logDir, `${sessionId}.jsonl`)` with no validation.
 * `POST /api/playground/sessions` on `apps/agent-server` takes `resumeSessionId` straight from an
 * unauthenticated HTTP body, checks only `typeof === 'string'`, and feeds it to `load()` — and the same
 * value becomes the session's own id, so it also reaches `save()` (writeFileSync + renameSync) and the
 * JSONL logger. A `../` id therefore reads AND writes outside the store directory.
 *
 * The CLI happened to be safe only because `--resume` resolves through `resolveSessionIdByIdOrName`,
 * an existence-allowlist over `list()`. The HTTP handler bypasses that helper entirely. The guard
 * belongs at the id boundary so every sink inherits it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSessionLogger } from '../session-logger.js';
import { NodeSessionLogSink } from '../session-log-sinks.js';
import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import { loadedOrMissing } from './store-load-helpers.js';

const TRAVERSAL_IDS = [
  '../escaped',
  '../../escaped',
  'nested/../../escaped',
  'sub/escaped',
  '..\\escaped',
  '/absolute',
];

/**
 * TRANS-007: a real record. This used to be a stub cast through `as unknown as` — no `cwd` — which
 * the store accepted because it did not decode. It now does, so a fixture that is not a record
 * cannot pretend to be one, and the cast is gone rather than widened.
 */
function makeRecord(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('SessionStore — session id path traversal (SEC-006)', () => {
  let root: string;
  let baseDir: string;
  let store: NodeSessionStore;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sec006-store-')));
    baseDir = join(root, 'sessions');
    store = new NodeSessionStore(baseDir);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each(TRAVERSAL_IDS)('save() rejects a traversing id (%s) and writes nothing outside', (id) => {
    expect(() => store.save(makeRecord(id))).toThrow(/session id/i);
    // nothing escaped into the parent of the store directory
    const escaped = readdirSync(root).filter((f) => f !== 'sessions');
    expect(escaped).toEqual([]);
  });

  it.each(TRAVERSAL_IDS)('load() rejects a traversing id (%s)', (id) => {
    expect(() => loadedOrMissing(store, id)).toThrow(/session id/i);
  });

  it.each(TRAVERSAL_IDS)('delete() rejects a traversing id (%s)', (id) => {
    expect(() => store.delete(id)).toThrow(/session id/i);
  });

  it('load() cannot read a JSON file outside the store directory', () => {
    writeFileSync(join(root, 'secret.json'), JSON.stringify({ id: 'secret', stolen: true }));
    expect(() => loadedOrMissing(store, '../secret')).toThrow(/session id/i);
  });

  it('delete() cannot unlink a file outside the store directory', () => {
    const victim = join(root, 'victim.json');
    writeFileSync(victim, '{}');
    expect(() => store.delete('../victim')).toThrow(/session id/i);
    expect(existsSync(victim)).toBe(true);
  });

  it('still accepts the id shapes the app actually generates', () => {
    for (const id of [
      'session_1730000000000_abc123def',
      crypto.randomUUID(),
      'test-session',
      'a',
    ]) {
      expect(() => store.save(makeRecord(id))).not.toThrow();
      expect(loadedOrMissing(store, id)?.id).toBe(id);
    }
  });
});

describe('FileSessionLogger — session id path traversal (SEC-006)', () => {
  let root: string;
  let logDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sec006-log-')));
    logDir = join(root, 'logs');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does not append to a path outside the log directory', () => {
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));
    // the logger swallows its own errors by design (logging must never break a session), so the
    // observable contract is that NO file appears outside logDir
    logger.log('../escaped', 'session_init', {});
    expect(existsSync(join(root, 'escaped.jsonl'))).toBe(false);
  });

  it('still writes a normal session log', () => {
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));
    logger.log('session_1730000000000_abc', 'session_init', {});
    expect(existsSync(join(logDir, 'session_1730000000000_abc.jsonl'))).toBe(true);
  });
});

describe('NodeSessionLogSink direct path boundaries', () => {
  let root: string;
  let logDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sec006-direct-log-sink-')));
    logDir = join(root, 'logs');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects a traversing session id when the public sink is called directly', () => {
    const sink = new NodeSessionLogSink(logDir);

    expect(() => sink.append('../escaped', '{}\n')).toThrow(/session id/i);
    expect(existsSync(join(root, 'escaped.jsonl'))).toBe(false);
  });

  it('rejects non-content-addressed and path-shaped payload digests', () => {
    const sink = new NodeSessionLogSink(logDir);
    const serialized = '{"safe":true}';
    const actualDigest = createHash('sha256').update(serialized).digest('hex');

    expect(() => sink.writeJson('safe-session', '../../escaped', serialized)).toThrow(/sha256/i);
    expect(() => sink.writeJson('safe-session', 'a'.repeat(64), serialized)).toThrow(/sha256/i);
    expect(() => sink.writeJson('safe-session', actualDigest, serialized)).not.toThrow();
    expect(existsSync(join(root, 'escaped.json'))).toBe(false);
  });
});
