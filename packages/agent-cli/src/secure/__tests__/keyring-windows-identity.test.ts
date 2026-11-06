import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { expect, it } from 'vitest';

import { createKeyringFileStore } from '../keyring-store.js';
import { fixtureKeyring } from './helpers.js';

it('creates and reads the same synthetic keyring on a real filesystem', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-identity-')));
  try {
    const path = join(root, 'secure', 'keyring.json');
    const { keyring } = await fixtureKeyring();
    const store = createKeyringFileStore({ root, path });
    store.create(keyring);
    const result = store.load();
    expect(result.status).toBe('present');
    if (result.status === 'present') {
      expect(serializeKeyring(result.keyring)).toBe(serializeKeyring(keyring));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
