import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import { expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { launchCertifiedRuntime } from '../certified-runtime-launch.js';
import { runDaemonAttachCommand } from '../daemon-attach-command.js';
import { runDaemonCommand } from '../daemon-command.js';
import { proveWorkspaceDaemon } from '../prove-workspace-daemon.js';
import { listSupervisedSessions, resolveSupervisedDirectory, stopSupervisedSession } from '../supervised-session-control.js';

it.skipIf(process.platform === 'win32')('refuses forged daemon status relayed to either real runtime', async () => {
  const home = realpathSync(mkdtempSync(join(realpathSync('/tmp'), 'sd-')));
  const env = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
  const runtime = createTestProductRuntime('test-product', env);
  const root = resolveSupervisedDirectory(runtime);
  const { keyring } = await fixtureKeyring();
  mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
  const owner = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  const entrypoint = fileURLToPath(new URL('../../testing/secure-runtime-entry.ts', import.meta.url));
  const execArgs = ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'];
  let ordinary: Awaited<ReturnType<typeof launchCertifiedRuntime>> | undefined;
  let daemon: Awaited<ReturnType<typeof launchCertifiedRuntime>> | undefined;
  try {
    ordinary = await launchCertifiedRuntime(home, { productRuntime: runtime, root, env, handover: owner, entrypoint, execArgs });
    daemon = await launchCertifiedRuntime(home, { productRuntime: runtime, root, env, handover: owner, entrypoint, execArgs, daemonRole: true });
    overrideProductSecureMode(runtime, true);
    const socketFor = (id: string): string => join(root, `${createHash('sha256').update(id).digest('hex').slice(0, 16)}.sock`);
    const publicSocket = socketFor(ordinary.id);
    const realSocket = `${publicSocket}.real`;
    renameSync(publicSocket, realSocket);
    let destination = realSocket;
    let stall = false;
    let stalledClosed: (() => void) | undefined;
    const fake = createServer((socket) => {
      let pending = Buffer.alloc(0);
      const read = (chunk: Buffer): void => {
        pending = Buffer.concat([pending, chunk]);
        const end = pending.indexOf(10);
        if (end < 0) return;
        socket.off('data', read);
        const request = JSON.parse(pending.subarray(0, end).toString()) as { command: string; id?: string; generation?: string };
        if (request.command === 'status') {
          socket.end(`${JSON.stringify({ id: ordinary!.id, generation: ordinary!.generation, status: 'running', cwd: home, daemon: true, restricted: true, certified: true })}\n`);
          return;
        }
        if (stall) {
          socket.once('close', () => stalledClosed?.());
          return;
        }
        const upstream = createConnection(destination);
        upstream.on('error', () => socket.destroy());
        socket.on('error', () => upstream.destroy());
        upstream.on('connect', () => { upstream.write(pending); socket.pipe(upstream).pipe(socket); });
      };
      socket.on('data', read);
    });
    await new Promise<void>((resolve) => fake.listen(publicSocket, resolve));
    const onlyOrdinary: typeof listSupervisedSessions = async (...args) => (await listSupervisedSessions(...args)).filter((row) => row.id === ordinary!.id);
    const openSecureOwner = () => openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const base = { productRuntime: runtime, cwd: home, root, list: onlyOrdinary, openSecureOwner, env: () => env,
      admit: async () => { throw new Error('Unexpected launch'); }, trusted: async () => false,
      stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) };
    const render = vi.fn(async () => 'user' as const);
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outputSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      for (const target of [realSocket, socketFor(daemon.id)]) {
        destination = target;
        expect(await runDaemonCommand(['start', '--restricted-workspace'], base)).toBe(1);
        expect(stderr.join('')).toMatch(/unproven runtime/i);
        expect(await runDaemonAttachCommand(['--attach'], { productRuntime: runtime, cwd: home, root, list: onlyOrdinary, isTTY: true, openSecureOwner, render })).toBe(1);
        expect(render).not.toHaveBeenCalled();
      }
      stall = true;
      const closed = new Promise<void>((resolve) => { stalledClosed = resolve; });
      const rows = await onlyOrdinary(root, undefined, { cwd: home, includeCwd: true, includeDaemon: true, includeGeneration: true });
      const candidate = rows[0];
      if (!candidate?.generation || candidate.daemon !== true) throw new Error('Missing forged candidate');
      const realRows = await listSupervisedSessions(root, undefined, { cwd: home, includeCwd: true, includeDaemon: true, includeGeneration: true });
      const realDaemon = realRows.find((row) => row.id === daemon!.id);
      if (!realDaemon?.generation || realDaemon.daemon !== true) throw new Error('Missing real daemon candidate');
      const began = Date.now();
      await expect(proveWorkspaceDaemon({ root, workspace: home, handover: owner,
        candidates: [{ ...candidate, generation: candidate.generation }, { ...realDaemon, generation: realDaemon.generation }], timeoutMs: 150,
      })).rejects.toThrow(/proof timed out/i);
      expect(Date.now() - began).toBeLessThan(2_000);
      await closed;
    } finally {
      outputSpy.mockRestore(); errorSpy.mockRestore();
      await new Promise<void>((resolve) => fake.close(() => resolve()));
      if (existsSync(publicSocket)) unlinkSync(publicSocket);
      renameSync(realSocket, publicSocket);
    }
  } finally {
    owner.dispose();
    if (ordinary) await stopSupervisedSession(ordinary.id, root, ordinary.generation);
    if (daemon) await stopSupervisedSession(daemon.id, root, daemon.generation);
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
