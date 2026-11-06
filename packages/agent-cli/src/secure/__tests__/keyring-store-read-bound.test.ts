/**
 * The size check is made on the open descriptor, but a file can still grow between that check and
 * the read. The read itself must therefore stop at the limit; kept apart because it replaces
 * `fstatSync` for the whole file to make the growth happen at exactly that moment.
 */
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureKeyring } from './helpers.js';

const growth = vi.hoisted(() => ({ path: undefined as string | undefined, bytes: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    fstatSync: ((...args: Parameters<typeof actual.fstatSync>) => {
      const stats = actual.fstatSync(...args);
      // The stats are taken first, then the file grows: what was checked is no longer what is read.
      if (growth.path !== undefined && growth.bytes > 0) {
        appendFileSync(growth.path, ' '.repeat(growth.bytes));
        growth.bytes = 0;
      }
      return stats;
    }) as typeof actual.fstatSync,
  };
});

const { KeyringStoreError, createKeyringFileStore } = await import('@robota-sdk/agent-local-host');

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-read-bound-')));
});

afterEach(() => {
  growth.path = undefined;
  growth.bytes = 0;
  rmSync(root, { recursive: true, force: true });
});

describe('keyring store — the read is bounded, not only the check', () => {
  it('refuses as too large a file that grew past the limit after its size was checked', async () => {
    const { keyring } = await fixtureKeyring();
    const path = join(root, 'secure', 'keyring.json');
    mkdirSync(join(root, 'secure'));
    writeFileSync(path, serializeKeyring(keyring), { mode: 0o600 });
    growth.path = path;
    growth.bytes = 1024 * 1024;

    let thrown: unknown;
    try {
      createKeyringFileStore({ path, root }).load();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyringStoreError);
    expect((thrown as InstanceType<typeof KeyringStoreError>).code).toBe('too-large');
  });
});
