import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createKeyring, openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { openRegisteredOwnerLink } from '../owner-link-client.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
import { runDaemonCommand } from '../daemon-command.js';
import { runDaemonAttachCommand } from '../daemon-attach-command.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10 }); });

it('certifies a real launched runtime and assigns its daemon role under owner proof', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'cert-')));
  roots.push(home);
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  const handover = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  try {
    const started = await launchCertifiedRuntime(home, { productRuntime: runtime, env, restricted: true, root,
      entrypoint: fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url)),
      execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'],
      handover, daemonRole: true });
    const owner = await openRegisteredOwnerLink({ root, ...started, handover });
    try {
      const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true, includeDaemon: true, includeSecure: true });
      expect(rows.find((row) => row.id === started.id)).toMatchObject({ daemon: true, secure: { certified: true }, generation: started.generation });
      overrideProductSecureMode(runtime, true);
      const output: string[] = [];
      const errors: string[] = [];
      const stranger = await createKeyring({ passphrase: 'another strong passphrase' });
      stranger.unlocked.lock();
      const base = { productRuntime: runtime, cwd: home, root, env: () => env, admit: async () => { throw new Error('Unexpected launch'); },
        trusted: async () => false, stdout: (s: string) => output.push(s), stderr: (s: string) => errors.push(s) };
      const refused = await runDaemonCommand(['start', '--json'], { ...base, openSecureOwner: () => openOwnerHandover(stranger.keyring, { type: 'passphrase', passphrase: 'another strong passphrase' }) });
      expect(refused).toBe(1);
      expect(errors.join('')).toMatch(/unproven runtime/i);
      const reused = await runDaemonCommand(['start', '--json'], { ...base, openSecureOwner: () => openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE }) });
      expect(reused).toBe(0);
      expect(JSON.parse(output.join(''))).toEqual({ id: started.id, generation: started.generation, mode: 'secure' });
      const attachOwner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
      const render = vi.fn(async () => 'user' as const);
      const confirm = vi.fn(async () => { throw new Error('Unexpected second confirmation'); });
      const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        const spoofName: typeof listSupervisedSessions = async (...args) => (await listSupervisedSessions(...args)).map((row) => ({ ...row, name: 'spoofed public name' }));
        const attached = await runDaemonAttachCommand(['--attach'], { productRuntime: runtime, cwd: home, root, list: spoofName, isTTY: true, render, confirm, openSecureOwner: async () => attachOwner });
        expect(attached).toBe(0);
        expect(render).toHaveBeenCalledOnce();
        expect(render).toHaveBeenCalledWith(expect.objectContaining({ sessionLabel: started.id }));
        expect(confirm).not.toHaveBeenCalled();
        expect(attachOwner.disposed).toBe(true);
      } finally { outputSpy.mockRestore(); }
    } finally {
      owner.close();
      await stopSupervisedSession(started.id, root, started.generation);
    }
  } finally { handover.dispose(); }
}, 60_000);

it('starts and certifies a daemon through the secure daemon command', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'cert-')));
  roots.push(home);
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  overrideProductSecureMode(runtime, true);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runDaemonCommand(['start', '--json', '--restricted-workspace'], {
    productRuntime: runtime, cwd: home, root, env: () => env, admit: async () => {}, trusted: async () => false,
    stdout: (s) => output.push(s), stderr: (s) => errors.push(s),
    openSecureOwner: () => openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE }),
    launchSecure: (cwd, options) => launchCertifiedRuntime(cwd, { ...options,
      entrypoint: fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url)),
      execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'] }),
  });
  expect(code, errors.join('')).toBe(0);
  const result = JSON.parse(output.join('')) as { id: string; generation: string; mode: string };
  expect(result.mode).toBe('secure');
  try {
    const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true, includeDaemon: true, includeSecure: true });
    expect(rows.find((row) => row.id === result.id)).toMatchObject({ daemon: true, secure: { certified: true }, generation: result.generation });
  } finally { await stopSupervisedSession(result.id, root, result.generation); }
}, 60_000);

it('stops a proved runtime when certification fails', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'cert-')));
  roots.push(home);
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  const handover = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  try {
    vi.spyOn(handover, 'certify').mockImplementation(() => { throw new Error('Certification refused'); });
    await expect(launchCertifiedRuntime(home, { productRuntime: runtime, env, restricted: true, root,
      entrypoint: fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url)),
      execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'],
      handover, daemonRole: true })).rejects.toThrow(/certification refused/i);
    expect(await listSupervisedSessions(root)).toEqual([]);
  } finally { handover.dispose(); }
}, 60_000);
