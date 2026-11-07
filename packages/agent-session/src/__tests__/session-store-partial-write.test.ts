/**
 * A user-store session write that fails after its bytes reached the path (#3679, secure
 * conversation). The atomic write renames the new record into place and then flushes the directory;
 * when that last step fails, the record on disk is the new one. The store must count those bytes as
 * its own, or one unlucky write would block saving the session for as long as the keys are locked.
 * The failure is injected, since a healthy disk never shows it.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createProcessOperationLock } from '@robota-sdk/agent-node-lock';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const io = vi.hoisted(() => ({
  failAfterNextWrite: false,
  failBeforeNextWrite: false,
  beforeNextWrite: undefined as (() => void) | undefined,
}));

vi.mock('@robota-sdk/agent-core/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core/node')>();
  return {
    ...actual,
    writeOwnerOnlyFile: (...args: Parameters<typeof actual.writeOwnerOnlyFile>) => {
      const beforeWrite = io.beforeNextWrite;
      io.beforeNextWrite = undefined;
      beforeWrite?.();
      if (io.failBeforeNextWrite) {
        io.failBeforeNextWrite = false;
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      }
      const result = actual.writeOwnerOnlyFile(...args);
      if (io.failAfterNextWrite) {
        io.failAfterNextWrite = false;
        throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' });
      }
      return result;
    },
  };
});

afterEach(() => {
  io.failAfterNextWrite = false;
  io.failBeforeNextWrite = false;
  io.beforeNextWrite = undefined;
});

function record(id: string, text: string): IInteractiveSessionRecord {
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

describe('a user-store session write that fails part-way', () => {
  it.each(['plain', 'sealed'] as const)(
    'keeps a forced release out of a %s restore commit and refuses the old writer afterward',
    (mode) => {
      const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-restore-fence-')));
      const sealing = mode === 'plain' ? 'plain' : { sealer: createTestArtifactSealer() };
      const store = new NodeSessionStore(dir, { sealing });
      const breaker = createProcessMarkers(path.join(dir, 'claims'), {
        operationLock: createProcessOperationLock(path.join(dir, 'claims')),
        lockWaitMs: 0,
      });
      const claim = store.claim('sess_a', { fresh: true });
      try {
        let during: ReturnType<typeof breaker.remove> | undefined;
        io.beforeNextWrite = () => {
          during = breaker.remove('sess_a', { force: true });
        };
        expect(store.saveRestoreTransaction(record('sess_a', 'restored'), { claim })).toEqual({
          status: 'committed',
        });
        expect(during).toEqual({ status: 'busy' });
        expect(breaker.remove('sess_a', { force: true }).status).toBe('removed');

        const newer = new NodeSessionStore(dir, { sealing });
        const newerClaim = newer.claim('sess_a');
        try {
          newer.save(record('sess_a', 'newer'), { claim: newerClaim });
          expect(store.saveRestoreTransaction(record('sess_a', 'stale'), { claim }).status).toBe(
            'unknown',
          );
          expect(newer.load('sess_a')).toMatchObject({
            status: 'valid',
            record: record('sess_a', 'newer'),
          });
        } finally {
          newerClaim.release();
        }
      } finally {
        claim.release();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('requires a live claim for a restore commit and fences a released claim', () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-restore-commit-')));
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    store.save(record('sess_a', 'first'));
    expect(() => store.saveRestoreTransaction(record('sess_a', 'without claim'))).toThrow(/claim/i);
    const claim = store.claim('sess_a');
    expect(store.saveRestoreTransaction(record('sess_a', 'second'), { claim })).toEqual({
      status: 'committed',
    });
    claim.release();
    expect(store.saveRestoreTransaction(record('sess_a', 'after release'), { claim }).status).toBe(
      'unknown',
    );
    expect(store.load('sess_a')).toMatchObject({
      status: 'valid',
      record: record('sess_a', 'second'),
    });
  });

  it.each(['before', 'after'] as const)(
    'reports an unknown restore commit after a write failure %s replacement',
    (failure) => {
      const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-restore-commit-')));
      const store = new NodeSessionStore(dir, { sealing: 'plain' });
      store.save(record('sess_a', 'first'));
      const claim = store.claim('sess_a');
      try {
        if (failure === 'before') io.failBeforeNextWrite = true;
        else io.failAfterNextWrite = true;
        const outcome = store.saveRestoreTransaction(record('sess_a', 'second'), { claim });
        expect(outcome.status).toBe('unknown');
        expect(store.load('sess_a')).toMatchObject({
          status: 'valid',
          record: record('sess_a', failure === 'before' ? 'first' : 'second'),
        });
      } finally {
        claim.release();
      }
    },
  );

  it('counts a record that reached the path before the write failed as its own', () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-partial-')));
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    const file = path.join(dir, 'sess_a.json');
    store.save(record('sess_a', 'first'));
    const first = readFileSync(file);

    io.failAfterNextWrite = true;
    expect(() => store.save(record('sess_a', 'second'))).toThrow(/EIO/);
    expect(readFileSync(file).equals(first)).toBe(false);
    sealer.lock();

    expect(() => store.save(record('sess_a', 'third'))).not.toThrow();
    sealer.unlock();
    expect(store.load('sess_a')).toMatchObject({
      status: 'valid',
      record: record('sess_a', 'third'),
    });
  });

  it('remembers nothing for a write that failed before its bytes reached the path', () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'session-partial-')));
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_a', 'first'));

    io.failBeforeNextWrite = true;
    expect(() => store.save(record('sess_a', 'second'))).toThrow(/ENOSPC/);
    sealer.lock();

    // The file is still the first record, which this store wrote and so may replace.
    expect(() => store.save(record('sess_a', 'third'))).not.toThrow();
  });
});
