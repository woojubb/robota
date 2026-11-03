/**
 * #3679 — repairing a legacy record's mode is best-effort on the read path. A record owned by
 * another account (EPERM) or on a chmod-ignoring mount makes `chmodSync` throw; because `list`
 * routes through `load`, a throw there would crash the whole resume picker. `load` must swallow a
 * failed repair and still return the record, upholding `outcomeForListedId`'s invariant.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    // Fail only the owner-only REPAIR (chmod to 0o600) of this planted record; the 0o644 setup
    // chmod, directory tightening (0o700) and every other chmod pass through, so save()/ensureDir()
    // behave normally.
    chmodSync: vi.fn((path: Parameters<typeof actual.chmodSync>[0], mode: Parameters<typeof actual.chmodSync>[1]) => {
      if (String(path).endsWith('foreign.json') && mode === 0o600) {
        throw Object.assign(new Error('EPERM: operation not permitted, chmod'), { code: 'EPERM' });
      }
      return actual.chmodSync(path, mode);
    }),
  };
});

const { chmodSync, mkdtempSync, rmSync, statSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { NodeSessionStore } = await import('../session-store.js');

const record = {
  id: 'foreign',
  cwd: '/tmp',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  messages: [],
};

describe.skipIf(process.platform === 'win32')('SessionStore legacy repair is non-fatal (#3679)', () => {
  it('load() and list() still return the record when the mode repair throws', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agent-store-foreign-'));
    try {
      const store = new NodeSessionStore(baseDir, { sealing: 'plain' });
      store.save(record);
      const path = join(baseDir, 'foreign.json');
      // Real chmod to 0644 (setup) — only the repair attempt on this path is forced to throw.
      (chmodSync as unknown as typeof import('node:fs').chmodSync)(path, 0o644);

      expect(() => store.load('foreign')).not.toThrow();
      expect(store.load('foreign').status).toBe('valid');
      expect(() => store.list()).not.toThrow();
      expect(store.list().map((entry) => entry.id)).toContain('foreign');

      // The repair was attempted and failed, so the mode is left as it was.
      expect(statSync(path).mode & 0o777).toBe(0o644);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
