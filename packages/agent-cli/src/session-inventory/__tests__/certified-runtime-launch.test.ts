import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openOwnerHandover } from '@robota-sdk/agent-keyring';
import { afterEach, expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { openRegisteredOwnerLink } from '../owner-link-client.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
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
    } finally {
      owner.close();
      await stopSupervisedSession(started.id, root, started.generation);
    }
  } finally { handover.dispose(); }
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
