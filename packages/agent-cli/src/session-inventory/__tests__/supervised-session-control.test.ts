import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  listSupervisedSessions,
  startSupervisedControl,
  stopSupervisedSession,
} from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const INCOMPLETE_ID = 'fe2c7f72-ecb3-4a05-9bb1-2563ec80e615';

describe('supervised session control', () => {
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
        { id: ID, liveness: 'alive', control: 'available' },
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
        { id: ID, liveness: 'alive', control: 'available' },
      ]);

      mkdirSync(join(root, INCOMPLETE_ID), { mode: 0o700 });
      expect(await listSupervisedSessions(root)).toEqual([
        { id: ID, liveness: 'alive', control: 'available' },
        { id: INCOMPLETE_ID, liveness: 'unknown', control: 'unavailable', problem: 'invalid-registration' },
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
        { id: ID, liveness: 'alive', control: 'available' },
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
