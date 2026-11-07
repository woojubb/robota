/**
 * Sealed session records (#3679, secure conversation) — what NodeSessionStore writes and concludes
 * when it is given an artifact sealer.
 *
 * Every case reads the BYTES on disk or drives a real load path, because the claim is about what is
 * stored and what a store tells a caller about it. The sealer is the agent-core double: opaque AES-GCM
 * under a key of its own, with the same lock/authenticate behaviour as the port's contract.
 *
 * What these protect, in order of cost if wrong:
 *   - a sealed file is never reported as missing or corrupt when the keys are merely locked, and is
 *     never overwritten by a store that has not read it (the only copy would be lost);
 *   - the plaintext never reaches the disk once a sealer is configured;
 *   - a store with no sealer is the store it always was.
 */

import { createProcessOperationLock } from '../process-operation-lock.js';

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { persistSession } from '../session-history-ops.js';
import { SESSION_RECORD_ENVELOPE_VERSION } from '../session-record-codec/index.js';
import { NodeSessionStore } from '../session-store.js';
import { SealedSessionUnreadableError } from '../sealed-session-refusal.js';
import { SealedSessionMemory } from '../sealed-session-memory.js';
import { openStoredSessionRecord } from '../stored-session-authorship.js';
import { digestOf, encodeStoredSession } from '../stored-session-codec.js';
import { StoredSessionRecords } from '../stored-session-record.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-7c2e91-secret-conversation-text';

/** What a store with `sealer` (or none) concludes from `stored`, remembering nothing. */
function decodeStoredSessionBytes(
  stored: Uint8Array,
  id: string,
  sealer: IArtifactSealer | undefined,
): ReturnType<StoredSessionRecords['load']> {
  if (sealer !== undefined) return openStoredSessionRecord(id, stored, sealer);
  return new StoredSessionRecords(
    'plain',
    {
      load: () => ({ file: { kind: 'plain', bytes: stored }, unreadable: { status: 'missing' } }),
      current: () => ({ kind: 'absent' }),
      replace: () => undefined,
    },
    ((directory: string) =>
      createProcessMarkers(directory, { operationLock: createProcessOperationLock(directory) }))(
      path.join(newStoreDir(), 'claims'),
    ),
  ).load(id);
}

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'sealed-store-')));
}

function record(id: string, text = CANARY, updatedAt = '2026-08-01T01:00:00.000Z') {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  } satisfies IInteractiveSessionRecord;
}

/**
 * A valid outcome as a store that seals reports it (#3679 step 3e): it says whose the record is and
 * which stored bytes it came from. Saves here state no provenance, so the records are unverified.
 */
function sealedValid(value: IInteractiveSessionRecord, authorship = 'unverified') {
  return {
    status: 'valid',
    record: value,
    authorship,
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  };
}

const fileOf = (dir: string, id: string): string => path.join(dir, `${id}.json`);

function plainEnvelope(value: IInteractiveSessionRecord): string {
  return JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: value }, null, 2);
}

describe('a store with a sealer writes nothing readable', () => {
  it('keeps the plaintext off the disk and leaves a framed, owner-only file', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));

    const bytes = readFileSync(fileOf(dir, 'sess_a'));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(bytes.includes(Buffer.from(CANARY))).toBe(false);
    expect(bytes.toString('latin1')).not.toContain('schemaVersion');
    if (process.platform !== 'win32') {
      expect(statSync(fileOf(dir, 'sess_a')).mode & 0o777).toBe(0o600);
    }
  });

  it('round-trips the record', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));
    expect(store.load('sess_a')).toEqual(sealedValid(record('sess_a')));
  });

  it('seals the same record to different bytes every time', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));
    const first = readFileSync(fileOf(dir, 'sess_a'));
    store.save(record('sess_a'));
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(first)).toBe(false);
  });
});

describe('a store with no sealer is the store it always was', () => {
  it('writes the plain pretty-printed envelope, byte for byte', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record('sess_a'));
    expect(readFileSync(fileOf(dir, 'sess_a'), 'utf-8')).toBe(plainEnvelope(record('sess_a')));
  });

  it('reports a sealed file as locked with no keys, not as missing or corrupt', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
      record('sess_a'),
    );
    const reader = new NodeSessionStore(dir, { sealing: 'plain' });
    // No unlock in this process would open it, which is what `no-keys` tells a surface apart.
    expect(reader.load('sess_a')).toEqual({ status: 'locked', reason: 'no-keys' });
    expect(reader.list()).toEqual([]);
    // Counted apart from locked ones, which an unlock would list.
    expect(reader.scan()).toEqual({ entries: [], locked: 0, noKeys: 1 });
  });
});

describe('a locked sealer', () => {
  it('reports locked for a sealed session and leaves it out of the listing, counting it', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    store.save(record('sess_b'));
    sealer.lock();

    expect(store.load('sess_a')).toEqual({ status: 'locked' });
    expect(store.load('sess_b')).toEqual({ status: 'locked' });
    expect(store.list()).toEqual([]);
    expect(store.scan().locked).toBe(2);
  });

  it('still lists the sessions that are not sealed and counts only the sealed ones', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    writeFileSync(fileOf(dir, 'sess_plain'), plainEnvelope(record('sess_plain')), 'utf-8');
    store.save(record('sess_sealed'));
    sealer.lock();

    expect(store.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
      ['sess_plain', 'valid'],
    ]);
    expect(store.scan().locked).toBe(1);
  });

  it('writes a NEW session with only the public side, and a later unlock reads it', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = new NodeSessionStore(dir, { sealing: { sealer } });

    store.save(record('sess_new'));
    expect(store.load('sess_new')).toEqual({ status: 'locked' });
    expect(readFileSync(fileOf(dir, 'sess_new')).includes(Buffer.from(CANARY))).toBe(false);

    sealer.unlock();
    expect(store.load('sess_new')).toEqual(sealedValid(record('sess_new')));
    expect(store.scan().locked).toBe(0);
  });

  it('deletes without keys', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    sealer.lock();
    store.delete('sess_a');
    expect(existsSync(fileOf(dir, 'sess_a'))).toBe(false);
    expect(store.load('sess_a')).toEqual({ status: 'missing' });
  });
});

describe('a sealed file that does not open is corrupt, not locked', () => {
  it('reports a sealed file copied to another session id as corrupt', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));
    copyFileSync(fileOf(dir, 'sess_a'), fileOf(dir, 'sess_b'));

    const outcome = store.load('sess_b');
    expect(outcome.status).toBe('corrupt');
    // The record that really belongs to sess_a is unaffected.
    expect(store.load('sess_a').status).toBe('valid');
  });

  it('reports a tampered sealed file as corrupt, naming no content', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));
    const bytes = readFileSync(fileOf(dir, 'sess_a'));
    bytes[bytes.length - 1] ^= 0x01;
    writeFileSync(fileOf(dir, 'sess_a'), bytes);

    const outcome = store.load('sess_a');
    if (outcome.status !== 'corrupt') throw new Error(`expected corrupt, got ${outcome.status}`);
    expect(JSON.stringify(outcome)).not.toContain(CANARY);
    expect(outcome.issues[0]?.message.length).toBeGreaterThan(0);
  });

  it('reports a truncated sealed file as corrupt', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));
    writeFileSync(fileOf(dir, 'sess_a'), readFileSync(fileOf(dir, 'sess_a')).subarray(0, 20));
    expect(store.load('sess_a').status).toBe('corrupt');
  });

  it('reports a file sealed with other keys as corrupt, and lists it as such', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
      record('sess_a'),
    );
    const otherKeys = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    expect(otherKeys.load('sess_a').status).toBe('corrupt');
    expect(otherKeys.list().map((entry) => [entry.id, entry.outcome.status])).toEqual([
      ['sess_a', 'corrupt'],
    ]);
    expect(otherKeys.scan().locked).toBe(0);
  });

  it('reports a sealer that fails in an unexpected way as corrupt rather than throwing', () => {
    const sealer = createTestArtifactSealer();
    const bytes = sealer.sealBytes(Buffer.from(plainEnvelope(record('sess_a'))), {
      kind: 'session-record',
      id: 'sess_a',
    });
    const broken = {
      ...sealer,
      openBytes: () => {
        throw new TypeError('boom with a secret in it');
      },
    };
    const outcome = decodeStoredSessionBytes(bytes, 'sess_a', broken);
    expect(outcome.status).toBe('corrupt');
    expect(JSON.stringify(outcome)).not.toContain('secret');
  });
});

describe('mixed directories while sessions migrate', () => {
  it('reads a plaintext record with a sealer configured, and seals it the next time it is saved', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    writeFileSync(fileOf(dir, 'sess_old'), plainEnvelope(record('sess_old')), 'utf-8');
    store.save(record('sess_new'));

    expect(
      store
        .list()
        .map((entry) => [entry.id, entry.outcome.status])
        .sort(),
    ).toEqual([
      ['sess_new', 'valid'],
      ['sess_old', 'valid'],
    ]);
    // Reading did not rewrite it: the file is still the old plaintext.
    expect(readFileSync(fileOf(dir, 'sess_old'), 'utf-8')).toBe(plainEnvelope(record('sess_old')));

    store.save(record('sess_old', 'edited'));
    expect(readFileSync(fileOf(dir, 'sess_old')).subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(store.load('sess_old')).toEqual(sealedValid(record('sess_old', 'edited')));
  });

  it('sorts readable sessions by recency across both forms', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    writeFileSync(
      fileOf(dir, 'sess_old'),
      plainEnvelope(record('sess_old', 'x', '2026-08-01T00:00:00.000Z')),
      'utf-8',
    );
    store.save(record('sess_new', 'y', '2026-08-02T00:00:00.000Z'));
    expect(store.list().map((entry) => entry.id)).toEqual(['sess_new', 'sess_old']);
  });
});

function thrownBy(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** What the autosave path runs: read before write, preserving what it does not own. */
function persistContext(store: NodeSessionStore, id: string, text: string) {
  return {
    sessionStore: store,
    sessionId: id,
    cwd: '/work',
    systemPrompt: 'p',
    toolSchemas: [],
    conversation: {
      id,
      cwd: '/work',
      messages: [
        {
          id: 'm-1',
          role: 'user',
          content: text,
          timestamp: new Date('2026-08-01T02:00:00.000Z'),
          state: 'complete',
        },
      ],
    },
    getFullHistory: () => [],
  } as unknown as Parameters<typeof persistSession>[0];
}

describe('a save never overwrites a sealed session this store cannot prove it wrote', () => {
  it('refuses another instance that never held the session, byte-identical, while locked', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_a'));
    sealer.lock();
    const before = readFileSync(fileOf(dir, 'sess_a'));
    // A second instance, as after a restart: it remembers nothing about sess_a.
    const restarted = new NodeSessionStore(dir, { sealing: { sealer } });

    const thrown = thrownBy(() => restarted.save(record('sess_a', 'a fresh record')));

    expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
    expect((thrown as SealedSessionUnreadableError).reason).toBe('locked');
    expect((thrown as SealedSessionUnreadableError).sessionId).toBe('sess_a');
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });

  it('refuses when the store has no sealer at all', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
      record('sess_a'),
    );
    const before = readFileSync(fileOf(dir, 'sess_a'));
    expect(() => new NodeSessionStore(dir, { sealing: 'plain' }).save(record('sess_a'))).toThrow(
      SealedSessionUnreadableError,
    );
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });

  it('refuses when the sealed file belongs to other keys, which may still open it', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
      record('sess_a'),
    );
    const before = readFileSync(fileOf(dir, 'sess_a'));
    const otherKeys = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    expect(() => otherKeys.save(record('sess_a'))).toThrow(
      expect.objectContaining({ code: 'SESSION_SEALED_UNREADABLE', reason: 'does-not-open' }),
    );
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });

  it('still rewrites a sealed session it can open, and a plaintext one', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    store.save(record('sess_a'));
    store.save(record('sess_a', 'second'));
    expect(store.load('sess_a')).toEqual(sealedValid(record('sess_a', 'second')));
    writeFileSync(fileOf(dir, 'sess_p'), plainEnvelope(record('sess_p')), 'utf-8');
    store.save(record('sess_p', 'second'));
    expect(store.load('sess_p')).toEqual(sealedValid(record('sess_p', 'second')));
  });

  it('keeps the autosave of another instance from replacing a locked session', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_a'));
    sealer.lock();
    const before = readFileSync(fileOf(dir, 'sess_a'));

    const outcome = persistSession(
      persistContext(new NodeSessionStore(dir, { sealing: { sealer } }), 'sess_a', 'x'),
    );

    expect(outcome).toEqual({ status: 'locked' });
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });
});

describe('a locked process keeps saving the sessions it holds', () => {
  it('saves a session it created while locked again, and the file changes', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = new NodeSessionStore(dir, { sealing: { sealer } });

    store.save(record('sess_new', 'first'));
    const first = readFileSync(fileOf(dir, 'sess_new'));
    store.save(record('sess_new', 'second turn'));
    const second = readFileSync(fileOf(dir, 'sess_new'));

    expect(second.equals(first)).toBe(false);
    expect(second.includes(Buffer.from('second turn'))).toBe(false);
    sealer.unlock();
    expect(store.load('sess_new')).toEqual(sealedValid(record('sess_new', 'second turn')));
  });

  it('saves a session it loaded to hold while unlocked after the keys lock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_a'));
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    expect(store.load('sess_a', { hold: true }).status).toBe('valid');
    sealer.lock();
    const before = readFileSync(fileOf(dir, 'sess_a'));

    store.save(record('sess_a', 'after the lock'));

    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(false);
    sealer.unlock();
    expect(store.load('sess_a')).toEqual(sealedValid(record('sess_a', 'after the lock')));
  });

  it('does not overwrite a file another writer replaced after the lock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    sealer.lock();
    // Another writer (same keys, public key only) puts different sealed bytes at the path.
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_b', 'theirs'));
    const theirs = sealer.sealBytes(Buffer.from('another writer'), {
      kind: 'session-record',
      id: 'sess_a',
    });
    writeFileSync(fileOf(dir, 'sess_a'), theirs);

    const thrown = thrownBy(() => store.save(record('sess_a', 'mine')));

    expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
    expect((thrown as SealedSessionUnreadableError).reason).toBe('changed');
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(Buffer.from(theirs))).toBe(true);
  });

  it('forgets a session when it is deleted, so a file that reappears is not its own', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    const kept = readFileSync(fileOf(dir, 'sess_a'));
    sealer.lock();
    store.delete('sess_a');
    // The very bytes it once wrote come back (a restored backup): no longer provably its own.
    writeFileSync(fileOf(dir, 'sess_a'), kept);

    expect(thrownBy(() => store.save(record('sess_a', 'again')))).toBeInstanceOf(
      SealedSessionUnreadableError,
    );
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(kept)).toBe(true);
  });

  it('does not remember what a listing or a count only browsed', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sess_a'));
    const browser = new NodeSessionStore(dir, { sealing: { sealer } });
    expect(browser.list()).toHaveLength(1);
    sealer.lock();
    expect(browser.scan().locked).toBe(1);
    expect(thrownBy(() => browser.save(record('sess_a', 'x')))).toBeInstanceOf(
      SealedSessionUnreadableError,
    );
  });

  it('keeps the autosave path going: read before write is answered from what the store holds', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    // A first persist while unlocked, with a name the autosave must go on preserving.
    store.save({ ...record('sess_a'), name: 'kept name', createdAt: '2026-07-01T00:00:00.000Z' });
    sealer.lock();

    const outcome = persistSession(persistContext(store, 'sess_a', 'typed while locked'));

    expect(outcome.status).toBe('valid');
    sealer.unlock();
    const loaded = store.load('sess_a');
    if (loaded.status !== 'valid') throw new Error(`expected valid, got ${loaded.status}`);
    expect(loaded.record.name).toBe('kept name');
    expect(loaded.record.createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(JSON.stringify(loaded.record.messages)).toContain('typed while locked');
  });

  it('offers the held copy only while the file is its own, and says when it changed', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    sealer.lock();

    expect(store.loadHeld('sess_a')).toEqual(sealedValid(record('sess_a')));
    expect(store.loadHeld('sess_unknown')).toBeUndefined();
    expect(new NodeSessionStore(dir, { sealing: { sealer } }).loadHeld('sess_a')).toBeUndefined();
    writeFileSync(
      fileOf(dir, 'sess_a'),
      sealer.sealBytes(Buffer.from('replaced'), { kind: 'session-record', id: 'sess_a' }),
    );
    // Held, but not what is there now: a writer reports that as `changed`, not as locked keys.
    expect(store.loadHeld('sess_a')).toEqual({ status: 'locked', reason: 'changed' });
  });

  it('bounds what it remembers, and a store with no sealer holds nothing', () => {
    const memory = new SealedSessionMemory();
    for (let index = 0; index < 100; index += 1) {
      memory.hold(`sess_${index}`, {
        digest: digestOf(Buffer.from(String(index))),
        text: 'text',
        kind: 'unverified',
      });
    }
    expect(memory.size).toBeLessThanOrEqual(32);
    expect(memory.state('sess_99')?.held?.digest).toBe(digestOf(Buffer.from('99')));
    expect(memory.state('sess_0')).toBeUndefined();

    const dir = newStoreDir();
    const plain = new NodeSessionStore(dir, { sealing: 'plain' });
    plain.save(record('sess_a'));
    expect(plain.loadHeld('sess_a')).toBeUndefined();
  });
});

describe.skipIf(process.platform === 'win32')('legacy mode repair reaches sealed files too', () => {
  it('tightens a world-readable sealed file on load, even while the keys are locked', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    sealer.lock();
    chmodSync(fileOf(dir, 'sess_a'), 0o644);

    expect(store.load('sess_a')).toEqual({ status: 'locked' });
    expect(statSync(fileOf(dir, 'sess_a')).mode & 0o777).toBe(0o600);
  });

  it('tightens every sealed file a listing or count browses', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a'));
    chmodSync(fileOf(dir, 'sess_a'), 0o640);
    sealer.lock();
    store.scan().locked;
    expect(statSync(fileOf(dir, 'sess_a')).mode & 0o077).toBe(0);
  });
});

describe('the stored-record codec on its own', () => {
  it('encodes a plain record as the envelope text and a sealed one as framed bytes', () => {
    const sealer = createTestArtifactSealer();
    const plain = encodeStoredSession(record('sess_a'), undefined);
    expect(Buffer.from(plain.stored).toString('utf8')).toBe(plainEnvelope(record('sess_a')));
    expect(plain.text).toBe(plainEnvelope(record('sess_a')));
    const sealed = encodeStoredSession(record('sess_a'), sealer).stored;
    expect(sealer.isSealedBytes(sealed)).toBe(true);
    expect(decodeStoredSessionBytes(sealed, 'sess_a', sealer)).toEqual(
      sealedValid(record('sess_a')),
    );
  });

  it('decodes plaintext to the same record with and without a sealer, which calls it unverified', () => {
    const bytes = Buffer.from(plainEnvelope(record('sess_a')));
    expect(decodeStoredSessionBytes(bytes, 'sess_a', undefined)).toEqual({
      status: 'valid',
      record: record('sess_a'),
    });
    expect(decodeStoredSessionBytes(bytes, 'sess_a', createTestArtifactSealer())).toEqual(
      sealedValid(record('sess_a')),
    );
  });
});
