import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  getVerifiedSupervisedPr,
  linkSupervisedPr,
  listSupervisedSessions,
  parseSupervisedPr,
  renameSupervisedSession,
  startSupervisedControl,
  stopSupervisedSession,
  unlinkSupervisedPr,
} from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const INCOMPLETE_ID = 'fe2c7f72-ecb3-4a05-9bb1-2563ec80e615';

describe('supervised session control', () => {
  it('accepts only bounded canonical HTTPS pull or merge-request URLs', () => {
    expect(parseSupervisedPr('https://github.com/team/repo/pull/123')).toEqual({
      url: 'https://github.com/team/repo/pull/123', host: 'github.com', number: 123, kind: 'pull',
    });
    expect(parseSupervisedPr('https://git.example.org/team/sub/repo/-/merge_requests/24')).toEqual({
      url: 'https://git.example.org/team/sub/repo/-/merge_requests/24',
      host: 'git.example.org', number: 24, kind: 'merge-request',
    });
    for (const url of [
      'http://github.com/team/repo/pull/1', 'https://user@github.com/team/repo/pull/1',
      'https://github.com:8443/team/repo/pull/1', 'https://github.com/team/repo/pull/1?token=x',
      'https://github.com/team/repo/pull/1#note', 'https://github.com/team/repo/pull/0',
      'https://github.com/team/repo/pull/9007199254740992',
      'https://github.com/team/repo/pull/1\n', `https://github.com/team/repo/pull/${'1'.repeat(2100)}`,
      'https://github.com/team/repo/issues/1',
    ]) expect(parseSupervisedPr(url)).toBeUndefined();
  });

  it('links, replaces and clears PRs only through a proven live owner; default rows stay PR-free', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-pr-'));
    const root = join(scratch, 'supervised');
    let association: ReturnType<typeof parseSupervisedPr>;
    const control = await startSupervisedControl(
      ID, () => undefined, root, () => 'idle', undefined, undefined, undefined, undefined,
      { get: () => association, set: (value) => { association = value; } },
    );
    const first = 'https://github.com/team/repo/pull/123';
    const second = 'https://git.example.org/team/repo/-/merge_requests/24';
    try {
      await linkSupervisedPr(ID, first, root);
      expect(await getVerifiedSupervisedPr(ID, root)).toEqual(parseSupervisedPr(first));
      expect(JSON.stringify(await listSupervisedSessions(root))).not.toContain('github.com');
      expect(await listSupervisedSessions(root, undefined, { includePr: true, pr: 123 })).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle', pr: parseSupervisedPr(first),
      }]);
      expect(await listSupervisedSessions(root, undefined, { pr: 24 })).toEqual([]);
      await linkSupervisedPr(ID, second, root);
      expect(await getVerifiedSupervisedPr(ID, root)).toEqual(parseSupervisedPr(second));
      expect(await listSupervisedSessions(root, undefined, { pr: 123 })).toEqual([]);
      await unlinkSupervisedPr(ID, root);
      expect(await getVerifiedSupervisedPr(ID, root)).toBeUndefined();
      expect(await listSupervisedSessions(root, undefined, { pr: 24 })).toEqual([]);
      await expect(linkSupervisedPr(ID, 'https://github.com/team/repo/issues/1', root)).rejects.toThrow(/PR/i);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
    await expect(linkSupervisedPr(ID, first, root)).rejects.toThrow();
    await expect(getVerifiedSupervisedPr(ID, root)).rejects.toThrow();
  });

  it('keeps a verified status readable when bounded PR, cwd, and name are all long', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-pr-frame-'));
    const root = join(scratch, 'supervised');
    const url = `https://git.example.org/${'g'.repeat(1900)}/repo/-/merge_requests/24`;
    const pr = parseSupervisedPr(url)!;
    const cwd = `/projects/${'x'.repeat(1900)}`;
    const name = 'N'.repeat(80);
    const control = await startSupervisedControl(
      ID, () => undefined, root, () => 'idle', () => cwd, undefined, () => name, undefined,
      { get: () => pr, set: () => undefined },
    );
    try {
      expect(await listSupervisedSessions(root, undefined, {
        includePr: true, includeCwd: true, includeName: true, pr: 24,
      })).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle', cwd, name, pr,
      }]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  it('aborts an in-flight listing probe and closes its control socket', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-abrt-'));
    const root = join(scratch, 'supervised');
    const control = await startSupervisedControl(ID, () => undefined, root);
    const socketName = readdirSync(root).find((name) => name.endsWith('.sock'))!;
    const socketPath = join(root, socketName);
    rmSync(socketPath);
    let accepted: Socket | undefined;
    let sawRequest: () => void = () => undefined;
    const requestSeen = new Promise<void>((resolve) => { sawRequest = resolve; });
    const hanging = createServer((socket) => {
      accepted = socket;
      socket.once('data', sawRequest);
    });
    await new Promise<void>((resolve) => hanging.listen(socketPath, resolve));
    try {
      const abort = new AbortController();
      const listing = listSupervisedSessions(root, abort.signal);
      await requestSeen;
      const closed = new Promise<void>((resolve) => accepted!.once('close', () => resolve()));
      abort.abort();
      await expect(listing).rejects.toThrow(/abort/i);
      await closed;
    } finally {
      accepted?.destroy();
      await new Promise<void>((resolve) => hanging.close(() => resolve()));
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('reports only current content-free activity and keeps initialization or shutdown unknown', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-activity-'));
    const root = join(scratch, 'supervised');
    let activity: 'working' | 'needs-input' | 'idle' | undefined;
    const control = await startSupervisedControl(ID, () => undefined, root, () => activity);
    try {
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' },
      ]);
      for (const current of ['idle', 'working', 'needs-input'] as const) {
        activity = current;
        expect(await listSupervisedSessions(root)).toEqual([
          { id: ID, liveness: 'alive', control: 'available', activity: current },
        ]);
      }
      activity = undefined;
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' },
      ]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('reports a waiting loop time only for a verified idle session', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-lw-'));
    const root = join(scratch, 'supervised');
    let activity: 'idle' | 'working' = 'idle';
    let nextLoopAt = '2030-01-01T00:10:00.000Z';
    const control = await startSupervisedControl(
      ID, () => undefined, root, () => activity, undefined, () => nextLoopAt,
    );
    try {
      expect(await listSupervisedSessions(root)).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle', nextLoopAt,
      }]);
      activity = 'working';
      expect(await listSupervisedSessions(root)).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'working',
      }]);
      activity = 'idle';
      nextLoopAt = 'not-a-time';
      expect(await listSupervisedSessions(root)).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle',
      }]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('lists and filters only a bounded name reported by the live owner', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-nm-'));
    const root = join(scratch, 'supervised');
    let name = 'Morning review';
    const control = await startSupervisedControl(
      ID, () => undefined, root, () => 'idle', undefined, undefined, () => name,
    );
    try {
      const named = { id: ID, liveness: 'alive', control: 'available', activity: 'idle', name };
      expect(await listSupervisedSessions(root)).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle',
      }]);
      expect(await listSupervisedSessions(root, undefined, { includeName: true })).toEqual([named]);
      expect(await listSupervisedSessions(root, undefined, { name: 'REVIEW', includeName: true })).toEqual([named]);
      expect(await listSupervisedSessions(root, undefined, { name: 'other' })).toEqual([]);
      name = 'bad\nname';
      expect(await listSupervisedSessions(root)).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle',
      }]);
      expect(await listSupervisedSessions(root, undefined, { name: 'bad' })).toEqual([]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('renames only a live owner through the guarded control endpoint', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-rename-'));
    const root = join(scratch, 'supervised');
    let name = 'Morning review';
    let refuse = false;
    const onRename = vi.fn((next: string) => {
      if (refuse) throw new Error('private storage failure');
      name = next;
    });
    const control = await startSupervisedControl(
      ID, () => undefined, root, () => 'idle', undefined, undefined, () => name, onRename,
    );
    try {
      await renameSupervisedSession(ID, 'Evening review', root);
      expect(onRename).toHaveBeenCalledExactlyOnceWith('Evening review');
      expect(await listSupervisedSessions(root, undefined, { includeName: true })).toEqual([{
        id: ID, liveness: 'alive', control: 'available', activity: 'idle', name: 'Evening review',
      }]);
      await expect(renameSupervisedSession(ID, 'bad\nname', root)).rejects.toThrow(/name/i);
      expect(onRename).toHaveBeenCalledTimes(1);
      refuse = true;
      await expect(renameSupervisedSession(ID, 'Refused name', root)).rejects.toThrow(/confirm rename/i);
      expect(name).toBe('Evening review');
      await expect(renameSupervisedSession('../escape', 'Safe name', root)).rejects.toThrow(/ID/i);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
    await expect(renameSupervisedSession(ID, 'After stop', root)).rejects.toThrow();
  });

  it('keeps activity unknown when the live process control reply cannot be verified', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-lost-'));
    const root = join(scratch, 'supervised');
    const control = await startSupervisedControl(ID, () => undefined, root, () => 'working');
    try {
      const socketName = readdirSync(root).find((name) => name.endsWith('.sock'));
      rmSync(join(root, socketName!));
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'unavailable', activity: 'unknown' },
      ]);
      expect(await listSupervisedSessions(root, undefined, { includeCwd: true })).toEqual([
        { id: ID, liveness: 'alive', control: 'unavailable', activity: 'unknown' },
      ]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('filters only by cwd returned from a verified live control reply without exposing paths in rows', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-cwd-'));
    const root = join(scratch, 'supervised');
    const project = join(scratch, 'project');
    const other = join(scratch, 'other');
    mkdirSync(project);
    mkdirSync(other);
    const control = await startSupervisedControl(ID, () => undefined, root, undefined, () => project);
    try {
      const row = { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' };
      expect(await listSupervisedSessions(root)).toEqual([row]);
      expect(await listSupervisedSessions(root, undefined, { cwd: project })).toEqual([row]);
      expect(await listSupervisedSessions(root, undefined, { includeCwd: true })).toEqual([{ ...row, cwd: project }]);
      expect(await listSupervisedSessions(root, undefined, { cwd: other })).toEqual([]);
      expect(JSON.stringify(await listSupervisedSessions(root))).not.toContain(project);
      const socketName = readdirSync(root).find((name) => name.endsWith('.sock'))!;
      rmSync(join(root, socketName));
      expect(await listSupervisedSessions(root, undefined, { cwd: project })).toEqual([]);
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'unavailable', activity: 'unknown' },
      ]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('lists and stops only the process that registered its own control socket', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-'));
    const root = join(scratch, 'supervised');
    let control: Awaited<ReturnType<typeof startSupervisedControl>>;
    let resolveStopped: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => { resolveStopped = resolve; });
    const stop = vi.fn(() => { void control.close().then(resolveStopped); });
    control = await startSupervisedControl(ID, stop, root);
    try {
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' },
      ]);
      await expect(stopSupervisedSession('../escape', root)).rejects.toThrow(/invalid/i);
      expect(stop).not.toHaveBeenCalled();
      const socketName = readdirSync(root).find((name) => name.endsWith('.sock'));
      const client = createConnection(join(root, socketName!));
      await new Promise<void>((resolve) => client.once('connect', resolve));
      client.write(`${JSON.stringify({ command: 'stop', id: ID })}\n`);
      await new Promise<void>((resolve) => client.once('data', () => resolve()));
      client.destroy();
      await stopped;
      expect(stop).toHaveBeenCalledTimes(1);
      expect(await listSupervisedSessions(root)).toEqual([]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses a linked or world-readable control directory', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'robota-supervised-unsafe-'));
    try {
      const unsafe = join(scratch, 'unsafe');
      mkdirSync(unsafe);
      chmodSync(unsafe, 0o755);
      await expect(startSupervisedControl(ID, () => undefined, unsafe)).rejects.toThrow(/private/i);

      const linked = join(scratch, 'linked');
      symlinkSync(unsafe, linked);
      await expect(startSupervisedControl(ID, () => undefined, linked)).rejects.toThrow(/private/i);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('does not let a half-open control client block supervisor shutdown', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-hanging-'));
    const root = join(scratch, 'supervised');
    const control = await startSupervisedControl(ID, () => undefined, root);
    const socketName = readdirSync(root).find((name) => name.endsWith('.sock'));
    expect(socketName).toBeDefined();
    const client = createConnection({ path: join(root, socketName!), allowHalfOpen: true });
    try {
      await new Promise<void>((resolve) => client.once('connect', resolve));
      client.write(`${JSON.stringify({ command: 'status', id: ID })}\n`);
      await new Promise<void>((resolve) => client.once('data', () => resolve()));
      expect(client.writable).toBe(true);
      await expect(control.close()).resolves.toBeUndefined();
    } finally {
      client.destroy();
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps healthy registrations visible while an unpublished or incomplete sibling exists', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-i-'));
    const root = join(scratch, 'supervised');
    const control = await startSupervisedControl(ID, () => undefined, root);
    try {
      mkdirSync(join(root, `.${INCOMPLETE_ID}.pending`), { mode: 0o700 });
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' },
      ]);

      mkdirSync(join(root, INCOMPLETE_ID), { mode: 0o700 });
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' },
        { id: INCOMPLETE_ID, liveness: 'unknown', control: 'unavailable', activity: 'unknown', problem: 'invalid-registration' },
      ]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps the supervisor alive when clients reset during status replies', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-reset-'));
    const root = join(scratch, 'supervised');
    const control = await startSupervisedControl(ID, () => undefined, root);
    const socketName = readdirSync(root).find((name) => name.endsWith('.sock'));
    try {
      await Promise.all(Array.from({ length: 16 }, async () => {
        const client = createConnection(join(root, socketName!));
        client.on('error', () => undefined);
        await new Promise<void>((resolve) => client.once('connect', resolve));
        client.write(`${JSON.stringify({ command: 'status', id: ID })}\n`);
        client.destroy();
      }));
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'unknown' },
      ]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses an overlong macOS socket path without publishing a false session', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-long-'));
    const root = join(scratch, 'x'.repeat(85));
    try {
      await expect(startSupervisedControl(ID, () => undefined, root)).rejects.toThrow(/too long/i);
      expect(existsSync(join(root, ID))).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
