import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { lstat, mkdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { adminPaths } from '../admin/paths.js';
import { bindAdminSocket } from '../admin/socket.js';
import { HostError } from '../errors.js';
import { FakeRuntime } from '../runtime/fake.js';
import { FAKE_RUNTIME_SETTING, startServe } from '../serve.js';
import { cleanTempDirs, tempDir } from './harness.js';
import { hostEnv, runCli, startHost, stopHosts } from './admin-harness.js';

afterEach(async () => {
  await stopHosts();
  await cleanTempDirs();
});

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );

async function rejection(promise: Promise<unknown>): Promise<HostError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HostError);
  return error as HostError;
}

/** Leaves a socket file behind with nobody listening, as a killed daemon does. */
async function leaveStaleSocket(socket: string): Promise<void> {
  await mkdir(join(socket, '..'), { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      '-e',
      'require("net").createServer().listen(process.argv[1], () => console.log("up"))',
      socket,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
  expect((await lstat(socket)).isSocket()).toBe(true);
}

describe('admin socket', () => {
  it('is owner-only in an owner-only directory even under a permissive umask', async () => {
    const previous = process.umask(0);
    let host;
    try {
      host = await startHost();
    } finally {
      expect(process.umask(previous)).toBe(0);
    }
    const { dir, socket } = adminPaths(host.env);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    const info = await lstat(socket);
    expect(info.isSocket()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('listens on the socket only, never on a TCP port', async () => {
    const dir = await tempDir();
    const server = createServer();
    const bound = await bindAdminSocket(server, adminPaths(hostEnv(dir)));
    expect(typeof server.address()).toBe('string');
    await new Promise((resolve) => server.close(resolve));
    await bound.release();
  });

  it('refuses a second serve, and the first keeps answering', async () => {
    const first = await startHost();
    const error = await rejection(startHost({ dir: first.dir }));
    expect(error.code).toBe('conflict');
    expect(error.message).toContain('already serving');
    expect((await first.cli(['list'])).code).toBe(0);
    expect(await exists(first.socket)).toBe(true);
  });

  it('replaces a socket left by a dead daemon', async () => {
    const dir = await tempDir();
    const env = hostEnv(dir);
    await leaveStaleSocket(adminPaths(env).socket);
    const host = await startHost({ dir });
    expect((await host.cli(['status'])).code).toBe(0);
  });

  it('lets exactly one of two simultaneous starts take over a stale socket', async () => {
    const dir = await tempDir();
    await leaveStaleSocket(adminPaths(hostEnv(dir)).socket);
    const start = (): ReturnType<typeof startServe> =>
      startServe(hostEnv(dir), {
        log: () => undefined,
        runtime: new FakeRuntime(),
        reconcileMs: 3_600_000,
      });
    const results = await Promise.allSettled([start(), start()]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(((lost[0] as PromiseRejectedResult).reason as HostError).code).toBe('conflict');
    await (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof startServe>>>).value.stop();
  });

  it('removes a takeover lock that a dead start left behind', async () => {
    const dir = await tempDir();
    const { socket, dir: runDir } = adminPaths(hostEnv(dir));
    await leaveStaleSocket(socket);
    const lock = join(runDir, '.takeover');
    await mkdir(lock);
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const host = await startHost({ dir });
    expect((await host.cli(['list'])).code).toBe(0);
  });

  it('does not remove a file that is not a socket', async () => {
    const dir = await tempDir();
    const { socket, dir: runDir } = adminPaths(hostEnv(dir));
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    await writeFile(socket, 'precious');
    const error = await rejection(startHost({ dir }));
    expect(error.message).toContain('not a socket');
    expect((await lstat(socket)).isFile()).toBe(true);
  });

  it('refuses a socket directory that other users can enter', async () => {
    const dir = await tempDir();
    const { dir: runDir } = adminPaths(hostEnv(dir));
    await mkdir(runDir, { recursive: true, mode: 0o755 });
    const error = await rejection(startHost({ dir }));
    expect(error.message).toContain('accessible to other users');
  });

  it('names a state directory whose socket path would not fit', () => {
    expect(() => adminPaths({ PERSONAL_AGENT_HOST_STATE_DIR: `/tmp/${'x'.repeat(120)}` })).toThrow(
      /too long/u,
    );
  });
});

describe('serve', () => {
  it('refuses to serve without a backend unless the test setting names the fake', async () => {
    const dir = await tempDir();
    const error = await rejection(startServe(hostEnv(dir), { log: () => undefined }));
    expect(error.code).toBe('refused');
    expect(error.message).toContain(FAKE_RUNTIME_SETTING);
    expect(await exists(adminPaths(hostEnv(dir)).socket)).toBe(false);

    const bad = await rejection(
      startServe(hostEnv(dir, { [FAKE_RUNTIME_SETTING]: 'perhaps' }), { log: () => undefined }),
    );
    expect(bad.code).toBe('config-invalid');
  });

  it('serves the fake runtime behind the setting and warns about it', async () => {
    const dir = await tempDir();
    const lines: string[] = [];
    const host = await startServe(hostEnv(dir, { [FAKE_RUNTIME_SETTING]: 'true' }), {
      log: (line) => lines.push(line),
      reconcileMs: 3_600_000,
    });
    try {
      expect(lines.join('\n')).toContain('WARNING');
      const result = await runCli(hostEnv(dir), ['status']);
      expect(result.code).toBe(0);
      expect(result.out).toContain('backend   container');
    } finally {
      await host.stop();
    }
  });

  it('removes the socket on shutdown, twice-safe, and clients then see it gone', async () => {
    const host = await startHost();
    expect(await exists(host.socket)).toBe(true);
    await host.host.stop();
    await host.host.stop();
    expect(await exists(host.socket)).toBe(false);
    expect((await runCli(host.env, ['list'])).code).toBe(5);
  });

  it('shuts down on SIGTERM and on SIGINT through the real entry point', async () => {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      const dir = await tempDir();
      const env = hostEnv(dir, { [FAKE_RUNTIME_SETTING]: 'true' });
      const signals = new EventEmitter();
      const done = runCli(env, ['serve'], '', signals);
      const socket = adminPaths(env).socket;
      for (let i = 0; i < 200 && !(await exists(socket)); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect((await runCli(env, ['list'])).code).toBe(0);
      signals.emit(signal);
      const result = await done;
      expect(result.code).toBe(0);
      expect(result.err).toContain(`${signal} received`);
      expect(await exists(socket)).toBe(false);
    }
  });

  it('keeps reconciling: a unit that exits is started again', async () => {
    const host = await startHost({ reconcileMs: 20 });
    expect((await host.cli(['add', 'vera', '--provider', 'anthropic'], 'sk-x-1')).code).toBe(0);
    host.runtime.crash('vera');
    for (let i = 0; i < 200; i += 1) {
      if ((await host.runtime.inspect('vera')).state === 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await host.runtime.inspect('vera')).state).toBe('running');
  });

  it('finishes a crashed add at start and audits it as recovered', async () => {
    const first = await startHost();
    await first.cli(['add', 'vera', '--provider', 'anthropic'], 'sk-x-1');
    await first.host.stop();
    // Leave the record the way a crash would: provisioning, never finished.
    const { AccountStore } = await import('../accounts/store.js');
    const store = await AccountStore.open(first.dir);
    const record = store.get('vera');
    if (!record) throw new Error('missing');
    await store.put({ ...record, state: 'provisioning' });
    const second = await startHost({ dir: first.dir });
    expect((await second.cli(['list'])).out).toContain('No accounts');
    expect(await second.audit()).toContain('"result":"recovered"');
  });
});
