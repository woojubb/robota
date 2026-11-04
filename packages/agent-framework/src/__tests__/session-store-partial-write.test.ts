/**
 * A project session write that fails part-way (#3679, secure conversation).
 *
 * The project store's write goes through the trusted-root mutation boundary. A write that stops
 * after some of its bytes reached the disk must neither damage the record that was there nor leave
 * a file the store will not recognise as its own: either would block saving that session for the
 * rest of the process once the keys lock. The failure is injected, since a healthy disk never shows
 * it. ARCH-047: project writes need the Linux stable-root host, so this runs on Linux only.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectSessionStore } from '../interactive/session-persistence.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const io = vi.hoisted(() => ({ failNextSessionWrite: false, failNextDirectoryFlush: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      const [target, content] = args;
      // Only a write through an open descriptor is the boundary's; half of it lands, then the disk fails.
      if (io.failNextSessionWrite && typeof target === 'number' && content instanceof Uint8Array) {
        io.failNextSessionWrite = false;
        actual.writeSync(target, content, 0, Math.floor(content.length / 2));
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
          code: 'ENOSPC',
        });
      }
      return actual.writeFileSync(...args);
    },
    fsyncSync: (descriptor: number) => {
      // The flush of the sessions directory after the rename: the new record is in place by then.
      if (io.failNextDirectoryFlush && actual.fstatSync(descriptor).isDirectory()) {
        io.failNextDirectoryFlush = false;
        throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' });
      }
      return actual.fsyncSync(descriptor);
    },
  };
});

const linux = process.platform === 'linux';

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

/**
 * A valid outcome as a store that seals reports it (#3679 step 3e): it says whose the record is and
 * which stored bytes it came from. Saves here state no provenance, and a write-only child's handed-over
 * record is never the owner's, so the records are unverified.
 */
function sealedValid(value: IInteractiveSessionRecord) {
  return {
    status: 'valid',
    record: value,
    authorship: 'unverified',
    digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'agent-project-partial-'));
});

afterEach(() => {
  io.failNextSessionWrite = false;
  io.failNextDirectoryFlush = false;
  rmSync(cwd, { recursive: true, force: true });
});

describe.runIf(linux)('a project session write that fails part-way', () => {
  it('leaves the previous record whole, and the session keeps saving after the keys lock', async () => {
    const access = await createTrustedProjectAccessFixture(cwd);
    if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
    const sealer = createTestArtifactSealer();
    const store = createProjectSessionStore(
      getWorkspaceProjectStateStorage(access.authority, 'sessions'),
      getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
      { sealing: { sealer } },
    );
    const file = join(cwd, '.agent', 'sessions', 'sess_a.json');
    store.save(record('sess_a', 'first'));
    const first = readFileSync(file);

    io.failNextSessionWrite = true;
    expect(() => store.save(record('sess_a', 'second'))).toThrow();
    expect(readFileSync(file).equals(first)).toBe(true);
    sealer.lock();

    expect(() => store.save(record('sess_a', 'third'))).not.toThrow();
    sealer.unlock();
    expect(store.load('sess_a')).toEqual(sealedValid(record('sess_a', 'third')));
  });

  it('counts a record that reached the path before the directory flush failed as its own', async () => {
    const access = await createTrustedProjectAccessFixture(cwd);
    if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
    const sealer = createTestArtifactSealer();
    const store = createProjectSessionStore(
      getWorkspaceProjectStateStorage(access.authority, 'sessions'),
      getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
      { sealing: { sealer } },
    );
    const file = join(cwd, '.agent', 'sessions', 'sess_a.json');
    store.save(record('sess_a', 'first'));
    const first = readFileSync(file);

    io.failNextDirectoryFlush = true;
    expect(() => store.save(record('sess_a', 'second'))).toThrow();
    // The rename happened: the second record is the one on disk.
    expect(readFileSync(file).equals(first)).toBe(false);
    sealer.lock();

    expect(() => store.save(record('sess_a', 'third'))).not.toThrow();
    sealer.unlock();
    expect(store.load('sess_a')).toEqual(sealedValid(record('sess_a', 'third')));
  });
});
