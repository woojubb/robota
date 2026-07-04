/**
 * CORE-019 — pins the atomic-write MECHANISM of SessionStore.save().
 *
 * The observable-behavior tests (session-store-atomic.test.ts) pass even with a direct
 * writeFileSync; this test asserts the crash-safe shape itself: bytes are written to a
 * same-directory temp path and moved into place with rename, never written to the final
 * path directly.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    renameSync: vi.fn(actual.renameSync),
  };
});

import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { SessionStore } from '../session-store.js';

describe('SessionStore atomic write mechanism (CORE-019)', () => {
  it('save() writes to a same-directory temp path, then renames into place', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'robota-store-mech-'));
    try {
      const store = new SessionStore(baseDir);
      const finalPath = join(baseDir, 'mech.json');

      store.save({
        id: 'mech',
        cwd: '/tmp',
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
        messages: [],
      });

      const writeCalls = vi.mocked(writeFileSync).mock.calls;
      const writtenPaths = writeCalls.map((call) => String(call[0]));
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
