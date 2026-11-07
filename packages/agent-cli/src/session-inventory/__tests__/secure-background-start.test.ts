import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import * as secureTerminal from '../../secure/secure-terminal.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring, scriptedSecureTerminal } from '../../secure/__tests__/helpers.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
import { startSecureBackground } from '../secure-background-start.js';
import { secureOwnerControl } from '../secure-owner-control.js';
import { runSessionViewCommand } from '../session-view-command.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';

it('requires an owner before taking a start lock and certifies a new background runtime', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'sb-')));
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  const lock = vi.fn(async () => () => {});
  try {
    await expect(startSecureBackground(home, { productRuntime: runtime, env, root, openOwner: async () => undefined, lock })).rejects.toThrow(/needs an unlock/i);
    await expect(startSecureBackground(home, { productRuntime: runtime, env, root, openOwner: async () => undefined, lock })).rejects.toThrow('test-product session start --background');
    expect(lock).not.toHaveBeenCalled();
    const owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const started = await startSecureBackground(home, { productRuntime: runtime, env, root, restricted: true, openOwner: async () => owner,
      launch: (cwd, options) => launchCertifiedRuntime(cwd, { ...options,
        entrypoint: fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url)),
        execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=product-source'] }),
    });
    try {
      expect(owner.disposed).toBe(true);
      const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true, includeSecure: true });
      expect(rows.find((row) => row.id === started.id)).toMatchObject({ secure: { certified: true }, generation: started.generation });
      const openOwner = () => openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
      await expect(secureOwnerControl({ productRuntime: runtime, root, id: started.id, command: 'rename', fields: { name: 'x' }, openOwner: async () => undefined })).rejects.toThrow(`test-product session rename ${started.id} <name>`);
      const renamed = await secureOwnerControl({ productRuntime: runtime, root, id: started.id, command: 'rename', fields: { name: 'Owner session' }, openOwner });
      expect(renamed.status).toBe('renamed');
      const status = await secureOwnerControl({ productRuntime: runtime, root, id: started.id, command: 'status', fields: {}, openOwner });
      expect(status).toMatchObject({ status: 'running', name: 'Owner session' });
      const refusedOwner = vi.fn(openOwner);
      await expect(secureOwnerControl({ productRuntime: runtime, root, id: started.id, generation: 'A'.repeat(22), command: 'status', fields: {}, openOwner: refusedOwner })).rejects.toThrow(/changed/i);
      expect(refusedOwner).not.toHaveBeenCalled();
      overrideProductSecureMode(runtime, true);
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const terminal = vi.spyOn(secureTerminal, 'openSecureTerminal').mockImplementation(() => scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE }).session);
      const previousExitCode = process.exitCode;
      try {
        for (const args of [['rename', started.id, 'Updated owner name'], ['link-pr', started.id, 'https://github.com/woojubb/robota/pull/1'], ['unlink-pr', started.id]]) {
          process.exitCode = 0;
          await runPreparsedCliCommand({ productRuntime: runtime, providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home) }, ['node', 'test-product', 'session', ...args], home);
          expect(process.exitCode, stderr.mock.calls.map(([text]) => String(text)).join('')).toBe(0);
        }
        expect(terminal).toHaveBeenCalledTimes(3);
        await secureOwnerControl({ productRuntime: runtime, root, id: started.id, command: 'link-pr', fields: { url: 'https://github.com/woojubb/robota/pull/1' }, openOwner });
        const openUrl = vi.fn(async () => undefined);
        let views = 0;
        const render = vi.fn(async (options: { deferPr?: boolean }) => {
          expect(options.deferPr).toBe(true);
          return views++ === 0 ? { kind: 'open-pr' as const, ...started } : { kind: 'closed' as const };
        });
        expect(await runSessionViewCommand([], { productRuntime: runtime, root, isTTY: true, settings: {}, render, openUrl, openSecureOwner: openOwner })).toBe(0);
        expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://github.com/woojubb/robota/pull/1');
      } finally { terminal.mockRestore(); stderr.mockRestore(); stdout.mockRestore(); process.exitCode = previousExitCode; }
    } finally { await stopSupervisedSession(started.id, root, started.generation); }
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 60_000);
