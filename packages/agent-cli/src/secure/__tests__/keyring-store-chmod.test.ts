/**
 * Tightening a loose mode is best effort: a keyring on a filesystem that refuses `chmod` must still
 * be readable, because the passphrase and not the mode is what protects it. Kept apart because it
 * replaces `fchmodSync` for the whole file.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureKeyring } from './helpers.js';

const chmodFailure = vi.hoisted(() => ({ active: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    fchmodSync: (...args: Parameters<typeof actual.fchmodSync>) => {
      if (chmodFailure.active)
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      return actual.fchmodSync(...args);
    },
  };
});

const { createKeyringFileStore } = await import('@robota-sdk/agent-local-host');

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-chmod-')));
});

afterEach(() => {
  chmodFailure.active = false;
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')(
  'keyring store — a filesystem that refuses chmod',
  () => {
    it('still reads the keyring and reports the mode it could not tighten', async () => {
      const { keyring } = await fixtureKeyring();
      const path = join(root, 'secure', 'keyring.json');
      mkdirSync(join(root, 'secure'));
      writeFileSync(path, serializeKeyring(keyring));
      chmodSync(path, 0o644);
      chmodFailure.active = true;

      const store = createKeyringFileStore({ path, root });
      expect(store.load().status).toBe('present');
      expect(store.inspect().mode).toBe(0o644);
      expect(statSync(path).mode & 0o777).toBe(0o644);
    });
  },
);
