import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, expect, it } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from './helpers/product-runtime.js';
import { desktopConversationMode, openDesktopSecureOwner } from '../desktop-secure-host.js';
import { writeProductConversationMode } from '../secure/conversation-mode-state.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../secure/__tests__/helpers.js';
import { resolveSupervisedDirectory, stopSupervisedSession } from '../session-inventory/supervised-session-control.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10 }); });

it('keeps a secure desktop session behind a native credential and a certified daemon', async () => {
  const workspace = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'desktop-owner-')));
  roots.push(workspace);
  const environment = createTestBinaryEnvironment(workspace, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', environment);
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  const { keyring } = await fixtureKeyring();
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  expect(desktopConversationMode(runtime.config)).toBe('plain');
  writeProductConversationMode(runtime.layout.userRoot, 'plain', 'secure');
  expect(desktopConversationMode(runtime.config)).toBe('secure');

  const fixture = fileURLToPath(new URL('../testing/secure-runtime-entry.ts', import.meta.url));
  const launchCommand = {
    executable: process.execPath,
    args: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source', fixture],
  };
  const options = {
    config: runtime.config,
    environment: runtime.environment,
    workspace,
    restricted: true,
    signal: new AbortController().signal,
    childEnvironment: environment,
    launchCommand,
  };
  await expect(openDesktopSecureOwner({ ...options, secret: { type: 'passphrase', value: 'wrong credential' } })).rejects.toThrow();
  const owner = await openDesktopSecureOwner({ ...options, secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE } });
  try {
    expect(owner.link.standing).toBe('owner');
    expect(owner.link.binding).toEqual(owner.selected);
    await expect(owner.link.control({ command: 'status', fields: {} })).resolves.toMatchObject({
      status: 'running', daemon: true, cwd: workspace, restricted: true,
    });
    const reused = await openDesktopSecureOwner({ ...options, secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE } });
    expect(reused.selected).toEqual(owner.selected);
    reused.link.close();
    reused.release();
  } finally {
    owner.link.close();
    owner.release();
    await stopSupervisedSession(owner.selected.runtimeId, resolveSupervisedDirectory(runtime), owner.selected.generation);
  }
}, 60_000);
