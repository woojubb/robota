import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from './helpers/product-runtime.js';
import { desktopConversationMode, openDesktopSecureOwner } from '../desktop-secure-host.js';
import { writeProductConversationMode } from '../secure/conversation-mode-state.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../secure/__tests__/helpers.js';
import { resolveSupervisedDirectory, stopSupervisedSession } from '../session-inventory/supervised-session-control.js';
import { workspaceRootBrokerEndpoint } from '../startup/workspace-root-broker-process.js';
import { requestWorkspaceRootBroker } from '../startup/workspace-root-broker.js';
import { startTestBroker } from './helpers/test-workspace-root-broker.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10 }); });

it.each([
  { nestedGit: false, revokeBeforeLock: false },
  { nestedGit: true, revokeBeforeLock: false },
  { nestedGit: true, revokeBeforeLock: true },
])('keeps a certified desktop session and globally locks after detach (%j)', async ({ nestedGit, revokeBeforeLock }) => {
  const workspaceRoot = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'desktop-owner-')));
  roots.push(workspaceRoot);
  if (nestedGit) execFileSync('git', ['init', '--quiet', workspaceRoot]);
  const workspace = nestedGit ? join(workspaceRoot, 'nested') : workspaceRoot;
  if (nestedGit) mkdirSync(workspace);
  const environment = createTestBinaryEnvironment(workspaceRoot, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', environment);
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  const { keyring } = await fixtureKeyring();
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  expect(desktopConversationMode(runtime.config)).toBe('plain');
  writeProductConversationMode(runtime.layout.userRoot, 'plain', 'secure');
  expect(desktopConversationMode(runtime.config)).toBe('secure');
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
  const broker = await startTestBroker(endpoint, dirname(endpoint), runtime.layout.userPaths.workspaceTrust);
  const prepared = await requestWorkspaceRootBroker(endpoint, { op: 'prepare', root: workspaceRoot });
  if (prepared.status !== 'prepared') throw new Error('Restricted test folder preparation failed.');
  const retained = await requestWorkspaceRootBroker(endpoint, { op: 'retainRestricted', root: workspaceRoot, candidate: prepared.candidate });
  if (retained.status !== 'restricted-held') throw new Error('Restricted test folder hold failed.');

  const fixture = fileURLToPath(new URL('../testing/secure-runtime-entry.ts', import.meta.url));
  const launchCommand = {
    executable: process.execPath,
    args: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=product-source', fixture],
  };
  const options = {
    config: runtime.config,
    environment: runtime.environment,
    workspace,
    restricted: true,
    restrictedHold: retained.hold,
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
    await owner.link.unlock();
    expect((await owner.link.control({ command: 'attach', fields: { mode: 'drive' } })).status).toBe('attached');
    const reused = await openDesktopSecureOwner({ ...options, secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE } });
    expect(reused.selected).toEqual(owner.selected);
    expect(reused.grantNeeded).toBe(false);
    expect((await reused.link.control({ command: 'attach', fields: { mode: 'observe' } })).status).toBe('attached');
    expect(await owner.link.control({ command: 'owner-detach', fields: {} })).toEqual({ status: 'detached' });
    if (revokeBeforeLock) {
      expect((await requestWorkspaceRootBroker(endpoint, { op: 'revoke', root: workspaceRoot })).status).toBe('revoked');
    }
    await owner.link.lock('screen-lock');
    await vi.waitFor(() => expect(reused.link.custody.unlocked).toBe(false));
    owner.link.close();
    await reused.link.closed;
    reused.release();
    if (!revokeBeforeLock) {
      const recovered = await openDesktopSecureOwner({ ...options, secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE } });
      expect(recovered.grantNeeded).toBe(true);
      expect(recovered.link.custody.unlocked).toBe(false);
      recovered.link.close();
      recovered.release();
    }
  } finally {
    owner.link.close();
    owner.release();
    await stopSupervisedSession(owner.selected.runtimeId, resolveSupervisedDirectory(runtime), owner.selected.generation);
    await broker.close();
  }
}, 60_000);
