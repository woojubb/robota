/**
 * CORE-019 — pins the atomic-write MECHANISM of SessionStore.save().
 *
 * The observable-behavior tests (session-store-atomic.test.ts) pass even with a direct
 * writeFileSync; this test asserts the crash-safe shape itself: bytes are written to a
 * same-directory temp path and moved into place with rename, never written to the final
 * path directly. The temp file is created exclusively (`wx`) and written through that
 * descriptor, so the path that is opened for writing is the one asserted here.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    renameSync: vi.fn(actual.renameSync),
  };
});

import { mkdtempSync, openSync, renameSync, rmSync } from 'fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { NodeSessionStore } from '../session-store.js';

describe('SessionStore atomic write mechanism (CORE-019)', () => {
  it('save() writes to a same-directory temp path, then renames into place', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agent-store-mech-'));
    try {
      const store = new NodeSessionStore(baseDir);
      const finalPath = join(baseDir, 'mech.json');

      store.save({
        id: 'mech',
        cwd: '/tmp',
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
        messages: [],
      });

      // Opened to be created (`wx`), as opposed to the plain reads that look at what is already there.
      const writtenPaths = vi
        .mocked(openSync)
        .mock.calls.filter((call) => call[1] === 'wx')
        .map((call) => String(call[0]));
      expect(writtenPaths).not.toContain(finalPath);

      const renameCalls = vi.mocked(renameSync).mock.calls;
      expect(renameCalls.length).toBe(1);
      const [tempPath, renamedTo] = renameCalls[0].map(String);
      expect(writtenPaths).toContain(tempPath);
      expect(renamedTo).toBe(finalPath);
      // Same-directory temp file — rename across directories/devices is not atomic
      expect(dirname(tempPath)).toBe(baseDir);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
