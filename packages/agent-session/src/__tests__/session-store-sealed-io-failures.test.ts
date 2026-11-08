/**
 * What the user's session store does when the disk fails it part-way (secure conversation).
 *
 * A failure a healthy disk never shows, so it is injected: reading the file already at a session's
 * path fails after it was opened. Only "no such file" means there is nothing to protect, so anything
 * else must refuse the save, not replace — and a load must say the record is there and unreadable,
 * not that it is missing.
 */

import { chmodSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeSessionStore } from '../session-store.js';
import { SealedSessionUnreadableError } from '../sealed-session-refusal.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const io = vi.hoisted(() => ({
  failNextBodyRead: false,
  recordDescriptor: undefined as number | undefined,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readSync: (...args: Parameters<typeof actual.readSync>) => {
      // The first read of a guard is the magic; the one after it is the body.
      const [descriptor, , , length] = args as unknown as [number, Uint8Array, number, number];
      if (io.failNextBodyRead && length === 4) io.recordDescriptor = descriptor;
      if (
        io.failNextBodyRead &&
        descriptor === io.recordDescriptor &&
        typeof length === 'number' &&
        length > 4
      ) {
        io.failNextBodyRead = false;
        throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });
      }
      return actual.readSync(...args);
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (io.failNextBodyRead && String(args[0]).endsWith('.json')) {
        io.failNextBodyRead = false;
        throw Object.assign(new Error('EIO: i/o error, read'), { code: 'EIO' });
      }
      return actual.readFileSync(...args);
    },
  };
});

afterEach(() => {
  io.failNextBodyRead = false;
  io.recordDescriptor = undefined;
});

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'sealed-io-')));
}

function record(id: string, text = 'conversation'): IInteractiveSessionRecord {
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

function thrownBy(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('a read that fails after the file was opened', () => {
  it('refuses the save and leaves the sealed file exactly as it was', () => {
    const dir = newStoreDir();
    new NodeSessionStore(dir, { sealing: { sealer: createTestArtifactSealer() } }).save(
      record('sess_a'),
    );
    const before = readFileSync(fileOf(dir, 'sess_a'));
    const store = new NodeSessionStore(dir, {
      sealing: { sealer: createTestArtifactSealer() },
    });

    io.failNextBodyRead = true;
    const thrown = thrownBy(() => store.save(record('sess_a', 'replacement')));

    expect(thrown).toBeInstanceOf(SealedSessionUnreadableError);
    expect((thrown as SealedSessionUnreadableError).reason).toBe('unreadable');
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
  });
});

describe('a load that cannot even look at the path', () => {
  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    'says the record is there and unreadable, with fixed text, never that it is missing',
    () => {
      const root = newStoreDir();
      const dir = path.join(root, 'sessions');
      const store = new NodeSessionStore(dir, { sealing: 'plain' });
      store.save(record('sess_a'));
      // A directory this account cannot search: every look at the file inside fails with EACCES.
      chmodSync(dir, 0o000);
      try {
        expect(store.load('sess_a')).toEqual({
          status: 'corrupt',
          issues: [{ path: '', message: 'could not read the session file (EACCES)' }],
        });
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(store.load('sess_a').status).toBe('valid');
    },
  );
});
