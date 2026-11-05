import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createKeyring, openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import { expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
import { openRegisteredOwnerLink } from '../owner-link-client.js';
import { openSecureAttach } from '../secure-attach-client.js';
import { runSessionAttachCommand } from '../session-attach-command.js';
import { runSessionViewCommand } from '../session-view-command.js';
import { resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';
import * as supervisedControl from '../supervised-session-control.js';

it('attaches an owner over the verified link and unlocks before detaching', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'sat-')));
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  const handover = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  let started: { id: string; generation: string } | undefined;
  try {
    started = await launchCertifiedRuntime(home, { productRuntime: runtime, env, root, restricted: true, handover,
      entrypoint: fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url)),
      execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'] });
    const attach = await openSecureAttach({ ...started, root, mode: 'observe', handover });
    expect(attach.driverId).toMatch(/^attach:/u);
    const otherLink = await openRegisteredOwnerLink({ ...started, root, handover });
    try {
      expect(otherLink.custody.unlocked).toBe(true);
      const locked = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Runtime stayed unlocked after detach.')), 1_000);
        otherLink.onCustody((state) => { if (!state.unlocked) { clearTimeout(timer); resolve(); } });
      });
      await attach.detach();
      await locked;
      expect(otherLink.custody.unlocked).toBe(false);
    } finally { otherLink.close(); }
    const other = await createKeyring({ passphrase: 'another strong passphrase' });
    other.unlocked.lock();
    const stranger = await openOwnerHandover(other.keyring, { type: 'passphrase', passphrase: 'another strong passphrase' });
    try {
      await expect(openSecureAttach({ ...started, root, mode: 'drive', handover: stranger })).rejects.toThrow();
    } finally { stranger.dispose(); }
    overrideProductSecureMode(runtime, true);
    const terminalOwner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const confirm = vi.fn(async () => { throw new Error('An extra confirmation must not run'); });
    const render = vi.fn(async () => 'user' as const);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const listActual = supervisedControl.listSupervisedSessions;
    const list = vi.spyOn(supervisedControl, 'listSupervisedSessions').mockImplementation(async (...args) =>
      (await listActual(...args)).map((row) => ({ ...row, name: 'spoofed public name' })));
    try {
      const code = await runSessionAttachCommand([started.id, '--observe'], {
        productRuntime: runtime, root, isTTY: true, render, confirm, openSecureOwner: async () => terminalOwner,
      });
      expect(code).toBe(0);
      expect(render).toHaveBeenCalledOnce();
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ sessionLabel: started.id }));
      expect(confirm).not.toHaveBeenCalled();
      expect(terminalOwner.disposed).toBe(true);
    } finally { list.mockRestore(); output.mockRestore(); }
    const viewOwner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    let renders = 0;
    const renderView = vi.fn(async (options: { attachWithoutConfirmation?: boolean }) => {
      expect(options.attachWithoutConfirmation).toBe(true);
      return renders++ === 0 ? { kind: 'attach' as const, ...started!, mode: 'observe' as const, groupByDirectory: false } : { kind: 'closed' as const };
    });
    const outputView = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const listForView = vi.spyOn(supervisedControl, 'listSupervisedSessions').mockImplementation(async (...args) =>
      (await listActual(...args)).map((row) => ({ ...row, name: 'spoofed public name' })));
    try {
      const code = await runSessionViewCommand([], { productRuntime: runtime, root, isTTY: true, settings: {}, render: renderView, renderAttached: render, openSecureOwner: async () => viewOwner });
      expect(code).toBe(0);
      expect(render).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ sessionLabel: started.id }));
      expect(viewOwner.disposed).toBe(true);
    } finally { listForView.mockRestore(); outputView.mockRestore(); }
    let viewOpen = false;
    let calls = 0;
    const start = vi.fn(async () => { expect(viewOpen).toBe(false); return 'new-runtime'; });
    const deferredView = vi.fn(async (options: { deferStart?: boolean }) => {
      expect(options.deferStart).toBe(true);
      viewOpen = true;
      const result = calls++ === 0 ? { kind: 'start' as const, choice: 'restricted' as const } : { kind: 'closed' as const };
      viewOpen = false;
      return result;
    });
    expect(await runSessionViewCommand([], { productRuntime: runtime, root, isTTY: true, settings: {}, render: deferredView, start, launchCwd: home })).toBe(0);
    expect(start).toHaveBeenCalledExactlyOnceWith(home, 'restricted');
  } finally {
    handover.dispose();
    if (started) await stopSupervisedSession(started.id, root, started.generation);
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
