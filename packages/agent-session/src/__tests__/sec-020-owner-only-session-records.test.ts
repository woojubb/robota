/**
 * A session record is not readable by another account on the host.
 *
 * These assert the MODE ON DISK after the real writers run, which is how the defect was measured in
 * the first place. Asserting that a helper was called would be a claim about source text, and the
 * defect was never that no mode was requested — `NodeSessionLogSink` requested 0700 and got 0777,
 * because `mkdirSync` does not touch a directory that already exists.
 *
 * Every case sets a permissive umask explicitly: under a restrictive one these pass whether the mode
 * is requested or not.
 *
 * Mode bits are asserted only where the platform's guarantee is `posix-mode`. On Windows inherited
 * ACLs govern and the bits a stat reports say nothing about who can read, so there the same cases
 * assert that the writers still produced the directory and the file.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ownerOnlyGuarantee } from '@robota-sdk/agent-core/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeSessionLogSink } from '../node-session-log-sink.js';
import { NodeSessionStore } from '../session-store.js';
import { loadedOrMissing } from './store-load-helpers.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const PERMISSIVE_UMASK = 0o022;
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

let root: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(PERMISSIVE_UMASK);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'sec-020-')));
});

afterEach(() => {
  process.umask(previousUmask);
});

const mode = (path: string): number => statSync(path).mode & 0o7777;

/**
 * `path` has permission bits `expected` where the platform defines them; elsewhere only that it
 * exists, since the mode a stat reports there is not a claim about who can read it.
 */
function expectMode(path: string, expected: number): void {
  if (ownerOnlyGuarantee() === 'posix-mode') expect(mode(path)).toBe(expected);
  else expect(existsSync(path)).toBe(true);
}

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

describe('NodeSessionStore', () => {
  it('a fresh store is 0700 and its records 0600 under umask 022', () => {
    // Measured before this change: 0755 and 0644.
    const base = join(root, 'sessions');
    new NodeSessionStore(base, { sealing: 'plain' }).save(record('a'));
    expectMode(base, OWNER_ONLY_DIRECTORY);
    expectMode(join(base, 'a.json'), OWNER_ONLY_FILE);
  });

  it('a sessions directory pre-created at 0777 is tightened, not adopted', () => {
    const base = join(root, 'sessions');
    mkdirSync(base);
    chmodSync(base, 0o777);
    new NodeSessionStore(base, { sealing: 'plain' }).save(record('b'));
    expectMode(base, OWNER_ONLY_DIRECTORY);
  });

  it('a record an older version left at 0644 is narrowed on the next save', () => {
    const base = join(root, 'sessions');
    const store = new NodeSessionStore(base, { sealing: 'plain' });
    store.save(record('c'));
    chmodSync(join(base, 'c.json'), 0o644);
    store.save(record('c'));
    expectMode(join(base, 'c.json'), OWNER_ONLY_FILE);
  });

  it('resume still works — save, load, list and delete are unchanged', () => {
    // A permission change that breaks resume is not a fix. This is the half the mode assertions
    // cannot see.
    const store = new NodeSessionStore(join(root, 'sessions'), { sealing: 'plain' });
    store.save(record('keep'));
    // `load` reports WHICH of four things happened, so "the record is there" and "the
    // record is gone" are now distinct answers rather than two readings of `undefined`.
    expect(loadedOrMissing(store, 'keep')?.id).toBe('keep');
    expect(store.list().map((entry) => entry.id)).toEqual(['keep']);
    store.delete('keep');
    expect(store.load('keep')).toEqual({ status: 'missing' });
  });
});

describe('NodeSessionLogSink', () => {
  it('a log directory pre-created at 0777 is tightened', () => {
    // The measured case: the sink asked for 0700 and got 0777, because `mkdirSync` with
    // `recursive: true` succeeds on an existing directory without touching its mode. Records were
    // 0600 the whole time, so another account could not READ one — it could unlink and replace it,
    // and could list every session id.
    const logs = join(root, 'logs');
    mkdirSync(logs);
    chmodSync(logs, 0o777);
    new NodeSessionLogSink(logs, { sealing: 'plain' }).append('s1', '{"a":1}\n');
    expectMode(logs, OWNER_ONLY_DIRECTORY);
    expectMode(join(logs, 's1.jsonl'), OWNER_ONLY_FILE);
  });

  it('a log an older version left at 0644 is narrowed before the next append', () => {
    const logs = join(root, 'logs');
    const sink = new NodeSessionLogSink(logs, { sealing: 'plain' });
    sink.append('s2', 'one\n');
    chmodSync(join(logs, 's2.jsonl'), 0o644);
    sink.append('s2', 'two\n');
    expectMode(join(logs, 's2.jsonl'), OWNER_ONLY_FILE);
    expect(readFileSync(join(logs, 's2.jsonl'), 'utf8')).toBe('one\ntwo\n');
  });

  it('the content-addressed payload directory and its files are owner-only', () => {
    const logs = join(root, 'logs');
    const sink = new NodeSessionLogSink(logs, { sealing: 'plain' });
    const serialized = '{"payload":true}';
    const sha256 = createSha(serialized);
    const reference = sink.writeJson('s3', sha256, serialized);
    expectMode(join(logs, 's3.payloads'), OWNER_ONLY_DIRECTORY);
    expectMode(join(logs, reference.relativePath), OWNER_ONLY_FILE);
  });

  it('an existing payload is not rewritten, but IS tightened', () => {
    // `flag: 'wx'` correctly declines to rewrite content-addressed bytes. Its mode is a different
    // question, and nothing else would ever repair a payload an older version wrote at 0644.
    const logs = join(root, 'logs');
    const sink = new NodeSessionLogSink(logs, { sealing: 'plain' });
    const serialized = '{"payload":true}';
    const sha256 = createSha(serialized);
    const reference = sink.writeJson('s4', sha256, serialized);
    const path = join(logs, reference.relativePath);
    chmodSync(path, 0o644);
    sink.writeJson('s4', sha256, serialized);
    expectMode(path, OWNER_ONLY_FILE);
    expect(readFileSync(path, 'utf8')).toBe(serialized);
  });

  it('a log directory that cannot be made owner-only disables logging rather than using it', () => {
    // Fail closed. A diagnostic sink must not kill the session, and it must not fall back to a
    // directory any account can read.
    const blocked = join(root, 'not-a-directory');
    writeFileSync(blocked, 'x');
    const sink = new NodeSessionLogSink(blocked, { sealing: 'plain' });
    expect(() => sink.append('s5', 'line\n')).not.toThrow();
  });
});

describe('the store root the host declares it owns', () => {
  it('a root left at 0755 by an older version is tightened with the sessions directory', () => {
    // The leaf was 0700 and the directory above it was not, on exactly the path
    // the change says matters most — the restricted-workspace fallback, where no settings or
    // device-store write ever runs to tighten the root on the session store's behalf.
    const owned = join(root, 'store-root');
    mkdirSync(owned);
    chmodSync(owned, 0o755);
    const base = join(owned, 'sessions');
    new NodeSessionStore(base, { ownedRoot: owned, sealing: 'plain' }).save(record('d'));
    expectMode(owned, OWNER_ONLY_DIRECTORY);
    expectMode(base, OWNER_ONLY_DIRECTORY);
  });

  it('without a declared root the store narrows only its own directory', () => {
    // The adapter does not interpret its base directory as a trusted root and must not guess that a
    // parent belongs to the product. Which ancestors are owned is composition's knowledge.
    const parent = join(root, 'someone-elses');
    mkdirSync(parent);
    chmodSync(parent, 0o755);
    new NodeSessionStore(join(parent, 'sessions'), { sealing: 'plain' }).save(record('e'));
    expectMode(parent, 0o755);
    expectMode(join(parent, 'sessions'), OWNER_ONLY_DIRECTORY);
  });
});
