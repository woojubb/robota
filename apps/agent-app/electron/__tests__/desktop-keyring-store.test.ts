import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { changePassphrase, createKeyring, serializeKeyring } from '@robota-sdk/agent-keyring';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import { createKeyringFileStore as createDesktopKeyringFileStore } from '../desktop-keyring-store.js';
const FIXTURE_PASSPHRASE = 'synthetic-passphrase-for-tests';
const OTHER_PASSPHRASE = 'different-synthetic-passphrase';

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

it('shares the CLI store and rejects a stale update after the desktop changes the keyring', async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-owner-store-')));
  const options = { root, path: join(root, 'secure', 'keyring.json') };
  const cli = createKeyringFileStore(options);
  const gui = createDesktopKeyringFileStore(options);
  const { keyring, unlocked } = await createKeyring({ passphrase: FIXTURE_PASSPHRASE });
  unlocked.lock();
  cli.create(keyring);
  const read = gui.load();
  expect(read.status).toBe('present');
  if (read.status !== 'present') throw new Error('Expected a keyring.');
  expect(serializeKeyring(read.keyring)).toBe(serializeKeyring(keyring));
  const changed = await changePassphrase(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE }, OTHER_PASSPHRASE);
  gui.save(changed, keyring);
  expect(() => cli.save(keyring, keyring)).toThrowError(expect.objectContaining({ code: 'changed' }));
  const final = cli.load();
  expect(final.status).toBe('present');
  if (final.status === 'present') expect(serializeKeyring(final.keyring)).toBe(serializeKeyring(changed));
});
