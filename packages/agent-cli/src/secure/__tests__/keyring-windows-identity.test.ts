import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

it('recovers an abandoned marker without waiting for an old dead owner', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-dead-marker-')));
  try {
    const secureDir = join(root, 'secure');
    const path = join(secureDir, 'keyring.json');
    const { keyring } = await fixtureKeyring();
    mkdirSync(secureDir);
    const marker = `${path}.lock`;
    writeFileSync(marker, JSON.stringify({ token: 'dead-owner', pid: 123456789, host: 'another-machine', monotonicMs: 0 }));
    const old = new Date(Date.now() - 120_000);
    utimesSync(marker, old, old);
    const store = createKeyringFileStore({ root, path, lockWaitMs: 0 });
    store.create(keyring);
    expect(store.load().status).toBe('present');
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
