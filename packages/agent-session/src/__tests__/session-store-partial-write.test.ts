/**
 * A user-store session write that fails after its bytes reached the path (#3679, secure
 * conversation). The atomic write renames the new record into place and then flushes the directory;
 * when that last step fails, the record on disk is the new one. The store must count those bytes as
 * its own, or one unlucky write would block saving the session for as long as the keys are locked.
 * The failure is injected, since a healthy disk never shows it.
 */

import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const io = vi.hoisted(() => ({ failAfterNextWrite: false, failBeforeNextWrite: false }));

vi.mock('@robota-sdk/agent-core/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core/node')>();
  return {
    ...actual,
    writeOwnerOnlyFile: (...args: Parameters<typeof actual.writeOwnerOnlyFile>) => {
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
