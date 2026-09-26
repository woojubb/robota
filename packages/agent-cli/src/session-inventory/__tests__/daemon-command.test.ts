import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDaemonCommand, type IDaemonCommandOptions } from '../daemon-command.js';

import { readProcessStartTime } from '../../remote-control/local-peer-registry.js';
import { acquireSupervisedDaemonStartLock, type ISupervisedSessionRow } from '../supervised-session-control.js';

const LIVE = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const OTHER = '0f6c3a5e-8c1b-4d2a-9f3e-1a2b3c4d5e6f';
const STARTED = 'fe2c7f72-ecb3-4a05-9bb1-2563ec80e615';
const GENERATION = 'Gq3vK8mP2xR9tY5wZ1aB4c';
const TOKEN = 'a'.repeat(64);
const URL_WITH_TOKEN = `ws://127.0.0.1:43127?token=${TOKEN}`;

let scratch: string;
let workspace: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rs-daemon-cmd-'));
  workspace = realpathSync(scratch);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function daemonRow(id: string, overrides: Partial<ISupervisedSessionRow> = {}): ISupervisedSessionRow {
  return {
    id, liveness: 'alive', control: 'available', activity: 'idle', cwd: workspace,
    generation: GENERATION, daemon: true, ...overrides,
  };
}

function harness(rows: readonly ISupervisedSessionRow[], overrides: Partial<IDaemonCommandOptions> = {}) {
  let stdout = '';
  let stderr = '';
  const list = vi.fn(async () => rows);
  const connect = vi.fn(async () => URL_WITH_TOKEN);
  const launch = vi.fn(async () => STARTED);
  const stop = vi.fn(async () => undefined);
  const admit = vi.fn(async () => undefined);
  const options: IDaemonCommandOptions = {
    cwd: scratch,
    env: () => ({ PATH: '/bin', ROBOTA_WS_PORT: '7777', ROBOTA_WS_TOKEN: 'inherited' }),
    admit,
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    root: join(scratch, 'supervised'),
    list: list as unknown as IDaemonCommandOptions['list'],
    connect,
    launch: launch as unknown as IDaemonCommandOptions['launch'],
    stop,
    ...overrides,
  };
  return { options, list, connect, launch, stop, admit, out: () => stdout, err: () => stderr };
}

describe('robota daemon', () => {
  it('reuses the live daemon of this workspace without admitting or launching', async () => {
    const h = harness([daemonRow(OTHER), daemonRow(LIVE)]);
    expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(0);
    expect(h.list).toHaveBeenCalledWith(h.options.root, undefined, expect.objectContaining({
      cwd: workspace, includeCwd: true, includeGeneration: true, includeDaemon: true,
    }));
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.admit).not.toHaveBeenCalled();
    // Several answered: the first by id is taken, bound to the generation it listed.
    expect(h.connect).toHaveBeenCalledWith(OTHER, h.options.root, GENERATION);
    expect(h.out()).toBe(`${JSON.stringify({ id: OTHER, url: URL_WITH_TOKEN })}\n`);
    expect(h.out().split('\n')).toEqual([expect.any(String), '']);
  });

  it('ignores sessions that are not a live daemon of this workspace', async () => {
    const h = harness([
      daemonRow(LIVE, { daemon: undefined }),
      daemonRow(OTHER, { control: 'unavailable' }),
      daemonRow(STARTED, { cwd: '/elsewhere' }),
    ]);
    expect(await runDaemonCommand(['status'], h.options)).toBe(0);
    expect(h.out()).toBe(`No daemon is running in ${workspace}.\n`);
  });

  it('launches a daemon after admission, with a fresh token in the environment and no fixed port', async () => {
    const h = harness([]);
    expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(0);
    expect(h.admit).toHaveBeenCalledWith(workspace);
    expect(h.launch).toHaveBeenCalledTimes(1);
    const [cwd, launchOptions] = h.launch.mock.calls[0] as unknown as [string, { env: NodeJS.ProcessEnv; daemon: boolean }];
    expect(cwd).toBe(workspace);
    expect(launchOptions.daemon).toBe(true);
    expect(launchOptions.env['ROBOTA_WS_TOKEN']).toMatch(/^[0-9a-f]{64}$/u);
    expect(launchOptions.env['ROBOTA_WS_TOKEN']).not.toBe('inherited');
    expect(launchOptions.env).not.toHaveProperty('ROBOTA_WS_PORT');
    expect(launchOptions.env['PATH']).toBe('/bin');
    expect(h.connect).toHaveBeenCalledWith(STARTED, h.options.root);
    expect(h.out()).toBe(`${JSON.stringify({ id: STARTED, url: URL_WITH_TOKEN })}\n`);
  });

  it('prints no token without --json', async () => {
    const started = harness([]);
    expect(await runDaemonCommand(['start'], started.options)).toBe(0);
    expect(started.out()).toBe(`Daemon ${STARTED} started in ${workspace}.\n`);
    const reused = harness([daemonRow(LIVE)]);
    expect(await runDaemonCommand(['start'], reused.options)).toBe(0);
    expect(reused.out()).toBe(`Daemon ${LIVE} running in ${workspace}.\n`);
    const status = harness([daemonRow(LIVE)]);
    expect(await runDaemonCommand(['status'], status.options)).toBe(0);
    expect(status.out()).toBe(`Daemon ${LIVE} running in ${workspace}.\n`);
    for (const out of [started.out(), reused.out(), status.out()]) expect(out).not.toContain(TOKEN);
  });

  it('refuses to launch where admission fails, on stderr with exit 1', async () => {
    const h = harness([], { admit: async () => { throw new Error('Workspace is not trusted.'); } });
    expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(1);
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.out()).toBe('');
    expect(h.err()).toBe('Workspace is not trusted.\n');
  });

  it('reports status as JSON', async () => {
    const none = harness([]);
    expect(await runDaemonCommand(['status', '--json'], none.options)).toBe(0);
    expect(none.out()).toBe('{"running":false}\n');
    const live = harness([daemonRow(LIVE)]);
    expect(await runDaemonCommand(['status', '--json'], live.options)).toBe(0);
    expect(JSON.parse(live.out())).toEqual({ running: true, id: LIVE, url: URL_WITH_TOKEN });
  });

  it('stops the live daemon bound to its generation, and succeeds when none runs', async () => {
    const live = harness([daemonRow(LIVE)]);
    expect(await runDaemonCommand(['stop'], live.options)).toBe(0);
    expect(live.stop).toHaveBeenCalledWith(LIVE, live.options.root, GENERATION);
    expect(live.out()).toBe(`Stopped daemon ${LIVE}.\n`);
    const none = harness([]);
    expect(await runDaemonCommand(['stop'], none.options)).toBe(0);
    expect(none.stop).not.toHaveBeenCalled();
    expect(none.out()).toBe(`No daemon is running in ${workspace}.\n`);
  });

  it('prints usage for an unknown action or flag', async () => {
    for (const args of [[], ['restart'], ['start', '--port'], ['status', '--json', 'x'], ['stop', '--json']]) {
      const h = harness([]);
      expect(await runDaemonCommand(args, h.options)).toBe(1);
      expect(h.err()).toMatch(/^Usage: robota daemon start/u);
      expect(h.list).not.toHaveBeenCalled();
    }
  });

  it('connects a reused daemon or stops it, naming the fix when it cannot hand over its connection', async () => {
    const h = harness([daemonRow(LIVE)], { connect: async () => { throw new Error('No connection.'); } });
    expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(1);
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.out()).toBe('');
    expect(h.err()).toMatch(/Run: robota daemon stop\n$/u);
  });

  it('stops the daemon it just launched when that daemon cannot hand over its connection', async () => {
    const h = harness([], { connect: async () => { throw new Error('No connection.'); } });
    h.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([daemonRow(STARTED)]);
    expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(1);
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.stop).toHaveBeenCalledWith(STARTED, h.options.root, GENERATION);
    expect(h.out()).toBe('');
    expect(h.err()).toBe('No connection.\n');
  });

  describe('concurrent starts in one workspace', () => {
    const lockFile = (root: string): string =>
      join(root, `.daemon-${createHash('sha256').update(workspace).digest('hex').slice(0, 16)}.lock`);

    it('waits for a start in progress, then reuses its daemon instead of launching another', async () => {
      const h = harness([]);
      const root = h.options.root as string;
      const first = await acquireSupervisedDaemonStartLock(workspace, root);
      expect(readdirSync(root)).toEqual([expect.stringMatching(/^\.daemon-[0-9a-f]{16}\.lock$/u)]);
      let released = false;
      h.list.mockImplementation(async () => (released ? [daemonRow(LIVE)] : []));
      const second = runDaemonCommand(['start', '--json'], h.options);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(h.launch).not.toHaveBeenCalled();
      released = true;
      first();
      expect(await second).toBe(0);
      expect(h.launch).not.toHaveBeenCalled();
      expect(h.connect).toHaveBeenCalledWith(LIVE, root, GENERATION);
      expect(existsSync(lockFile(root))).toBe(false);
    });

    it('never removes a lock left by a start that is gone: the start refuses and names unlock', async () => {
      const h = harness([]);
      const root = h.options.root as string;
      mkdirSync(root, { mode: 0o700 });
      const gone = spawnSync(process.execPath, ['-e', '']).pid;
      writeFileSync(lockFile(root), `${gone} Mon Jan  1 00:00:00 2024`, { mode: 0o600 });
      expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(1);
      expect(h.launch).not.toHaveBeenCalled();
      expect(h.err()).toMatch(/no longer running.*robota daemon unlock\n$/u);
      expect(existsSync(lockFile(root))).toBe(true);
    });

    it('unlock removes a lock whose owner is gone, and only at the user\'s request', async () => {
      const h = harness([]);
      const root = h.options.root as string;
      mkdirSync(root, { mode: 0o700 });
      const gone = spawnSync(process.execPath, ['-e', '']).pid;
      writeFileSync(lockFile(root), `${gone} Mon Jan  1 00:00:00 2024`, { mode: 0o600 });
      expect(await runDaemonCommand(['unlock'], h.options)).toBe(0);
      expect(h.out()).toMatch(/^Removed the daemon start lock in /u);
      expect(existsSync(lockFile(root))).toBe(false);
      expect(await runDaemonCommand(['unlock'], h.options)).toBe(0);
      expect(h.out()).toMatch(/No daemon start lock in /u);
      expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(0);
      expect(h.launch).toHaveBeenCalledTimes(1);
    });

    it('a lock whose pid was reused by another process counts as gone: start refuses, unlock removes it', async () => {
      const h = harness([]);
      const root = h.options.root as string;
      mkdirSync(root, { mode: 0o700 });
      // This pid is alive, but not the process that took the lock.
      writeFileSync(lockFile(root), `${process.pid} Mon Jan  1 00:00:00 2024`, { mode: 0o600 });
      expect(await runDaemonCommand(['start', '--json'], h.options)).toBe(1);
      expect(h.err()).toMatch(/no longer running.*robota daemon unlock\n$/u);
      expect(h.launch).not.toHaveBeenCalled();
      expect(await runDaemonCommand(['unlock'], h.options)).toBe(0);
      expect(existsSync(lockFile(root))).toBe(false);
    });

    it('unlock keeps a lock whose start is still running', async () => {
      const h = harness([]);
      const root = h.options.root as string;
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(lockFile(root), `${process.pid} ${readProcessStartTime(process.pid)}`, { mode: 0o600 });
      expect(await runDaemonCommand(['unlock'], h.options)).toBe(1);
      expect(h.err()).toMatch(/still running.*its lock was kept/u);
      expect(existsSync(lockFile(root))).toBe(true);
    });

    it('gives up on a lock held by a live start after its wait', async () => {
      const h = harness([]);
      const root = h.options.root as string;
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(lockFile(root), `${process.pid} ${readProcessStartTime(process.pid)}`, { mode: 0o600 });
      await expect(acquireSupervisedDaemonStartLock(workspace, root, { timeoutMs: 200, pollMs: 20 }))
        .rejects.toThrow(/Another daemon start is still running.*robota daemon unlock/u);
      expect(existsSync(lockFile(root))).toBe(true);
    });
  });
});
