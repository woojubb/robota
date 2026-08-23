/**
 * SEC-020 (issue #2021) — a session record is not readable by another account on the host.
 *
 * These assert the MODE ON DISK after the real writers run, which is how the defect was measured in
 * the first place. Asserting that a helper was called would be a claim about source text, and the
 * defect was never that no mode was requested — `NodeSessionLogSink` requested 0700 and got 0777,
 * because `mkdirSync` does not touch a directory that already exists.
 *
 * Every case sets a permissive umask explicitly: under a restrictive one these pass whether the mode
 * is requested or not.
 */

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeSessionLogSink } from '../session-log-sinks.js';
import { NodeSessionStore } from '../session-store.js';
import { loadedOrMissing } from './store-load-helpers.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const PERMISSIVE_UMASK = 0o022;
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

let root: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(PERMISSIVE_UMASK);
  root = mkdtempSync(join(tmpdir(), 'sec-020-'));
});

afterEach(() => {
  process.umask(previousUmask);
});

const mode = (path: string): number => statSync(path).mode & 0o7777;

/** The sink refuses any reference whose digest is not the exact content address. */
const createSha = (serialized: string): string =>
  createHash('sha256').update(serialized).digest('hex');

function record(id: string): IInteractiveSessionRecord {
  const now = new Date().toISOString();
  return {
    id,
    cwd: root,
    messages: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as IInteractiveSessionRecord;
}

describe('SEC-020 — NodeSessionStore', () => {
  it('TC-15: a fresh store is 0700 and its records 0600 under umask 022', () => {
    // Measured before this change: 0755 and 0644.
    const base = join(root, 'sessions');
    new NodeSessionStore(base).save(record('a'));
    expect(mode(base)).toBe(OWNER_ONLY_DIRECTORY);
    expect(mode(join(base, 'a.json'))).toBe(OWNER_ONLY_FILE);
  });

  it('TC-16: a sessions directory pre-created at 0777 is tightened, not adopted', () => {
    const base = join(root, 'sessions');
    mkdirSync(base);
    chmodSync(base, 0o777);
    new NodeSessionStore(base).save(record('b'));
    expect(mode(base)).toBe(OWNER_ONLY_DIRECTORY);
  });

  it('TC-17: a record an older version left at 0644 is narrowed on the next save', () => {
    const base = join(root, 'sessions');
    const store = new NodeSessionStore(base);
    store.save(record('c'));
    chmodSync(join(base, 'c.json'), 0o644);
    store.save(record('c'));
    expect(mode(join(base, 'c.json'))).toBe(OWNER_ONLY_FILE);
  });

  it('TC-18: resume still works — save, load, list and delete are unchanged', () => {
    // A permission change that breaks resume is not a fix. This is the half the mode assertions
    // cannot see.
    const store = new NodeSessionStore(join(root, 'sessions'));
    store.save(record('keep'));
    // TRANS-007: `load` reports WHICH of four things happened, so "the record is there" and "the
    // record is gone" are now distinct answers rather than two readings of `undefined`.
    expect(loadedOrMissing(store, 'keep')?.id).toBe('keep');
    expect(store.list().map((entry) => entry.id)).toEqual(['keep']);
    store.delete('keep');
    expect(store.load('keep')).toEqual({ status: 'missing' });
  });
});

describe('SEC-020 — NodeSessionLogSink', () => {
  it('TC-19: a log directory pre-created at 0777 is tightened', () => {
    // The measured case: the sink asked for 0700 and got 0777, because `mkdirSync` with
    // `recursive: true` succeeds on an existing directory without touching its mode. Records were
    // 0600 the whole time, so another account could not READ one — it could unlink and replace it,
    // and could list every session id.
    const logs = join(root, 'logs');
    mkdirSync(logs);
    chmodSync(logs, 0o777);
    new NodeSessionLogSink(logs).append('s1', '{"a":1}\n');
    expect(mode(logs)).toBe(OWNER_ONLY_DIRECTORY);
    expect(mode(join(logs, 's1.jsonl'))).toBe(OWNER_ONLY_FILE);
  });

  it('TC-20: a log an older version left at 0644 is narrowed before the next append', () => {
    const logs = join(root, 'logs');
    const sink = new NodeSessionLogSink(logs);
    sink.append('s2', 'one\n');
    chmodSync(join(logs, 's2.jsonl'), 0o644);
    sink.append('s2', 'two\n');
    expect(mode(join(logs, 's2.jsonl'))).toBe(OWNER_ONLY_FILE);
    expect(readFileSync(join(logs, 's2.jsonl'), 'utf8')).toBe('one\ntwo\n');
  });

  it('TC-21: the content-addressed payload directory and its files are owner-only', () => {
    const logs = join(root, 'logs');
    const sink = new NodeSessionLogSink(logs);
    const serialized = '{"payload":true}';
    const sha256 = createSha(serialized);
    const reference = sink.writeJson('s3', sha256, serialized);
    expect(mode(join(logs, 's3.payloads'))).toBe(OWNER_ONLY_DIRECTORY);
    expect(mode(join(logs, reference.relativePath))).toBe(OWNER_ONLY_FILE);
  });

  it('TC-22: an existing payload is not rewritten, but IS tightened', () => {
    // `flag: 'wx'` correctly declines to rewrite content-addressed bytes. Its mode is a different
    // question, and nothing else would ever repair a payload an older version wrote at 0644.
    const logs = join(root, 'logs');
    const sink = new NodeSessionLogSink(logs);
    const serialized = '{"payload":true}';
    const sha256 = createSha(serialized);
    const reference = sink.writeJson('s4', sha256, serialized);
    const path = join(logs, reference.relativePath);
    chmodSync(path, 0o644);
    sink.writeJson('s4', sha256, serialized);
    expect(mode(path)).toBe(OWNER_ONLY_FILE);
    expect(readFileSync(path, 'utf8')).toBe(serialized);
  });

  it('TC-23: a log directory that cannot be made owner-only disables logging rather than using it', () => {
    // Fail closed. A diagnostic sink must not kill the session, and it must not fall back to a
    // directory any account can read.
    const blocked = join(root, 'not-a-directory');
    writeFileSync(blocked, 'x');
    const sink = new NodeSessionLogSink(blocked);
    expect(() => sink.append('s5', 'line\n')).not.toThrow();
  });
});

describe('SEC-020 — the store root the host declares it owns', () => {
  it('TC-35: a root left at 0755 by an older version is tightened with the sessions directory', () => {
    // Review of PR #2224: the leaf was 0700 and the directory above it was not, on exactly the path
    // the change says matters most — the restricted-workspace fallback, where no settings or
    // device-store write ever runs to tighten the root on the session store's behalf.
    const owned = join(root, 'store-root');
    mkdirSync(owned);
    chmodSync(owned, 0o755);
    const base = join(owned, 'sessions');
    new NodeSessionStore(base, owned).save(record('d'));
    expect(mode(owned)).toBe(OWNER_ONLY_DIRECTORY);
    expect(mode(base)).toBe(OWNER_ONLY_DIRECTORY);
  });

  it('TC-36: without a declared root the store narrows only its own directory', () => {
    // The adapter does not interpret its base directory as a trusted root and must not guess that a
    // parent belongs to the product. Which ancestors are owned is composition's knowledge.
    const parent = join(root, 'someone-elses');
    mkdirSync(parent);
    chmodSync(parent, 0o755);
    new NodeSessionStore(join(parent, 'sessions')).save(record('e'));
    expect(mode(parent)).toBe(0o755);
    expect(mode(join(parent, 'sessions'))).toBe(OWNER_ONLY_DIRECTORY);
  });
});
