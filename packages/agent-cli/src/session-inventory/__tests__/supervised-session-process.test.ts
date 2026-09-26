import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  connectSupervisedDaemon, linkSupervisedPr, listSupervisedSessions, renameSupervisedSession, stopSupervisedSession, unlinkSupervisedPr,
} from '../supervised-session-control.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

const fixture = fileURLToPath(new URL('./fixtures/supervised-serve-fixture.ts', import.meta.url));
const hungFixture = fileURLToPath(new URL('./fixtures/supervised-hung-start.mjs', import.meta.url));
const SECRET_MARKER = 'SUPERVISED_SECRET_MUST_NOT_APPEAR';

describe('detached supervised runtime', () => {
  it('forwards an explicit launch name from the owner without storing it in registration', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-np-'));
    const root = join(scratch, 'supervised');
    let id: string | undefined;
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
        name: 'Morning review',
      });
      await vi.waitFor(async () => expect(await listSupervisedSessions(root, undefined, { includeName: true })).toEqual([{
        id, liveness: 'alive', control: 'available', activity: 'idle', name: 'Morning review',
      }]), { timeout: 15_000, interval: 100 });
      await renameSupervisedSession(id, 'Evening review', root);
      expect(await listSupervisedSessions(root, undefined, { includeName: true })).toEqual([{
        id, liveness: 'alive', control: 'available', activity: 'idle', name: 'Evening review',
      }]);
      expect(JSON.stringify(await listSupervisedSessions(root))).not.toContain('Evening review');
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain('Morning review');
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain('Evening review');
      const url = 'https://github.com/team/repo/pull/123';
      await linkSupervisedPr(id, url, root);
      expect(await listSupervisedSessions(root, undefined, { includePr: true, pr: 123 })).toEqual([{
        id, liveness: 'alive', control: 'available', activity: 'idle',
        pr: { url, host: 'github.com', number: 123, kind: 'pull' },
      }]);
      expect(JSON.stringify(await listSupervisedSessions(root))).not.toContain(url);
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain(url);
      await unlinkSupervisedPr(id, root);
      expect(await listSupervisedSessions(root, undefined, { includePr: true, pr: 123 })).toEqual([]);
      await stopSupervisedSession(id, root);
    } finally {
      if (id) {
        try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs as a daemon that hands its owner the URL with the token its environment carried', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-daemon-'));
    const root = join(scratch, 'supervised');
    const token = 'd'.repeat(64);
    let child: ChildProcess | undefined;
    let id: string | undefined;
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root, ROBOTA_WS_TOKEN: token },
        daemon: true,
        onSpawn: (spawned) => { child = spawned; },
      });
      expect(child?.spawnargs).toContain('--daemon');
      expect(child?.spawnargs.join(' ')).not.toContain(token);
      expect(await listSupervisedSessions(root, undefined, { includeDaemon: true })).toEqual([{
        id, liveness: 'alive', control: 'available',
        activity: expect.stringMatching(/^(unknown|idle)$/), daemon: true,
      }]);
      expect(await connectSupervisedDaemon(id, root)).toBe(`ws://127.0.0.1:9?token=${token}`);
      await stopSupervisedSession(id, root);
    } finally {
      if (id) {
        try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses to start a daemon whose WebSocket transport has no endpoint', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-daemon-nows-'));
    const root = join(scratch, 'supervised');
    let child: ChildProcess | undefined;
    try {
      await expect(launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root, ROBOTA_WS_TOKEN: 'd'.repeat(64), ROBOTA_TEST_NO_WS_URL: '1' },
        daemon: true,
        onSpawn: (spawned) => { child = spawned; },
      })).rejects.toThrow('The daemon has no WebSocket endpoint; enable the ws transport.');
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
      expect(await listSupervisedSessions(root)).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses to start under a directory too long for its control socket, naming the directory and the fix', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-long-'));
    const root = join(scratch, 'x'.repeat(100), 'supervised');
    let child: ChildProcess | undefined;
    try {
      const start = launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
        onSpawn: (spawned) => { child = spawned; },
      });
      await expect(start).rejects.toThrow(`Supervised session control socket path is too long under ${root}`);
      await expect(start).rejects.toThrow('Use a shorter HOME, or set XDG_RUNTIME_DIR to a short private directory');
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('remains available after its launcher disconnects, then shuts down by owned ID', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-process-'));
    const root = join(scratch, 'supervised');
    let child: ChildProcess | undefined;
    let id: string | undefined;
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root, ROBOTA_TEST_SECRET_MARKER: SECRET_MARKER },
        onSpawn: (spawned) => { child = spawned; },
      });
      expect(child?.connected).toBe(false);
      expect(child?.exitCode).toBeNull();
      const rows = await listSupervisedSessions(root);
      expect(rows).toEqual([{
        id, liveness: 'alive', control: 'available',
        activity: expect.stringMatching(/^(unknown|idle)$/),
      }]);
      expect(await listSupervisedSessions(root, undefined, { cwd: realpathSync(process.cwd()) })).toEqual([{
        id, liveness: 'alive', control: 'available',
        activity: expect.stringMatching(/^(unknown|idle)$/),
      }]);
      expect(await listSupervisedSessions(root, undefined, { cwd: realpathSync(scratch) })).toEqual([]);
      expect(JSON.stringify(rows)).not.toContain(realpathSync(process.cwd()));
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain(realpathSync(process.cwd()));
      // The launcher handshake proves the control process is alive, not that async session
      // initialization has finished. It may legitimately report unknown before becoming idle.
      await vi.waitFor(async () => {
        expect(await listSupervisedSessions(root)).toEqual([
          { id, liveness: 'alive', control: 'available', activity: 'idle' },
        ]);
      }, { timeout: 15_000, interval: 100 });
      expect(JSON.stringify(rows)).not.toContain(SECRET_MARKER);
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain(SECRET_MARKER);
      await stopSupervisedSession(id, root);
      expect(await listSupervisedSessions(root)).toEqual([]);
    } finally {
      if (id) {
        try { await stopSupervisedSession(id, root); } catch { /* already stopped or failed before registration */ }
      }
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('does not present a crashed supervisor as a controllable live session', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-crash-'));
    const root = join(scratch, 'supervised');
    let child: ChildProcess | undefined;
    try {
      const id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
        onSpawn: (spawned) => { child = spawned; },
      });
      const stopped = new Promise<void>((resolve) => child?.once('exit', () => resolve()));
      child?.kill('SIGKILL');
      await stopped;
      expect(await listSupervisedSessions(root)).toEqual([
        { id, liveness: 'dead', control: 'unavailable', activity: 'unknown' },
      ]);
      expect(await listSupervisedSessions(root, undefined, { cwd: realpathSync(process.cwd()) })).toEqual([]);
      await expect(stopSupervisedSession(id, root)).rejects.toThrow(/not proven alive/i);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);

  it('reaps a detached runtime that refuses startup and ignores graceful termination', async () => {
    let child: ChildProcess | undefined;
    try {
      await expect(launchSupervisedSession(process.cwd(), {
        entrypoint: hungFixture,
        execArgs: [],
        env: {},
        onSpawn: (spawned) => { child = spawned; },
      })).rejects.toThrow(/refused to start/i);
      expect(child?.signalCode).toBe('SIGKILL');
      expect(child?.connected).toBe(false);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 10_000);

  it('cleans up host and control when the launcher disconnects before acknowledging readiness', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-abandon-'));
    const root = join(scratch, 'supervised');
    const id = randomUUID();
    const child = spawn(process.execPath, [
      '--import', 'tsx', '--conditions=source', fixture,
      '--serve', '--supervised-session-id', id,
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('fixture never became ready')), 5_000);
        child.once('message', (message: unknown) => {
          clearTimeout(timer);
          if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'ready') resolve();
          else reject(new Error('fixture sent an unexpected readiness message'));
        });
        child.once('exit', () => reject(new Error('fixture exited before readiness')));
      });
      child.disconnect();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('abandoned fixture did not exit')), 5_000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      expect(await listSupervisedSessions(root)).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 15_000);
});
