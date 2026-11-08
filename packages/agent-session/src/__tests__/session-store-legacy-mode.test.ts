/**
 * A record an older version wrote at 0644 is repaired to owner-only the next time the store
 * reads it. The owner-only write already tightens a record it REWRITES; a session that is only
 * resumed or listed was never rewritten, so its world-readable mode survived. `load` (which `list`
 * routes through) now tightens on read, so browsing or resuming a legacy session repairs it.
 */
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

const record = {
  id: 'legacy',
  cwd: '/tmp',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  messages: [],
};

describe.skipIf(process.platform === 'win32')('SessionStore legacy mode repair', () => {
  it('load() tightens a world-readable legacy record to owner-only', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agent-store-legacy-'));
    try {
      const store = new NodeSessionStore(baseDir, { sealing: 'plain' });
      store.save(record);
      const path = join(baseDir, 'legacy.json');
      chmodSync(path, 0o644); // simulate a record written by an older build
      expect(statSync(path).mode & 0o777).toBe(0o644);

      expect(store.load('legacy').status).toBe('valid');

      expect(statSync(path).mode & 0o077).toBe(0);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('list() repairs every legacy record it browses', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agent-store-legacy-list-'));
    try {
      const store = new NodeSessionStore(baseDir, { sealing: 'plain' });
      store.save({ ...record, id: 'a' });
      store.save({ ...record, id: 'b' });
      chmodSync(join(baseDir, 'a.json'), 0o644);
      chmodSync(join(baseDir, 'b.json'), 0o640);

      store.list();

      expect(statSync(join(baseDir, 'a.json')).mode & 0o077).toBe(0);
      expect(statSync(join(baseDir, 'b.json')).mode & 0o077).toBe(0);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
