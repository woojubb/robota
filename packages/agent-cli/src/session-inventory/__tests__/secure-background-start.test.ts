import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openOwnerHandover } from '@robota-sdk/agent-keyring';
import { expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
import { startSecureBackground } from '../secure-background-start.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';

it('requires an owner before taking a start lock and certifies a new background runtime', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'sb-')));
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  const lock = vi.fn(async () => () => {});
  try {
    await expect(startSecureBackground(home, { productRuntime: runtime, env, root, openOwner: async () => undefined, lock })).rejects.toThrow(/needs an unlock/i);
    expect(lock).not.toHaveBeenCalled();
    const owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const started = await startSecureBackground(home, { productRuntime: runtime, env, root, restricted: true, openOwner: async () => owner,
      launch: (cwd, options) => launchCertifiedRuntime(cwd, { ...options,
        entrypoint: fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url)),
        execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'] }),
    });
    try {
      expect(owner.disposed).toBe(true);
      const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true, includeSecure: true });
      expect(rows.find((row) => row.id === started.id)).toMatchObject({ secure: { certified: true }, generation: started.generation });
    } finally { await stopSupervisedSession(started.id, root, started.generation); }
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 60_000);
