import { type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stopSupervisedSession } from '../supervised-session-control.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

const fixture = fileURLToPath(new URL('./fixtures/supervised-serve-fixture.ts', import.meta.url));

/** Launch the fixture runtime, attach to it in `mode` over its control socket, and run `body`. */
async function withAttachedRuntime(
  prefix: string,
  env: Record<string, string>,
  mode: 'drive' | 'observe',
  body: (context: {
    readonly id: string;
    readonly root: string;
    readonly generation: string;
    readonly lines: Record<string, unknown>[];
    readonly send: (frame: Record<string, unknown>) => void;
    readonly closed: Promise<void>;
    readonly child: () => ChildProcess | undefined;
    readonly stopped: () => void;
  }) => Promise<void>,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const root = join(scratch, 'supervised');
  let id: string | undefined;
  let child: ChildProcess | undefined;
  try {
    id = await launchSupervisedSession(process.cwd(), {
      entrypoint: fixture,
      execArgs: ['--import', 'tsx', '--conditions=source'],
      env: { ROBOTA_TEST_SUPERVISED_ROOT: root, ...env },
      onSpawn: (spawned) => { child = spawned; },
    });
    const generation = String((JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')) as {
      generation?: unknown;
    }).generation);
    const socket = createConnection(join(root, readdirSync(root).find((name) => name.endsWith('.sock'))!));
    socket.on('error', () => undefined);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.setEncoding('utf8');
    const lines: Record<string, unknown>[] = [];
    let buffered = '';
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let end = buffered.indexOf('\n');
      while (end !== -1) {
        lines.push(JSON.parse(buffered.slice(0, end)) as Record<string, unknown>);
        buffered = buffered.slice(end + 1);
        end = buffered.indexOf('\n');
      }
    });
    const send = (frame: Record<string, unknown>): void => { socket.write(`${JSON.stringify(frame)}\n`); };
    send({ command: 'attach', id, generation, mode, protocol: 1 });
    await expect.poll(() => lines.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const attachedId = id;
    try {
      await body({
        id: attachedId, root, generation, lines, send, closed, child: () => child,
        stopped: () => { id = undefined; },
      });
    } finally {
      socket.destroy();
    }
  } finally {
    if (id) {
      try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('attach to a detached supervised runtime', () => {
  it('streams the session protocol over the control socket and ends when the session stops', async () => {
    await withAttachedRuntime('rs-atp-', {}, 'observe', async ({ id, root, generation, lines, send, closed, child, stopped }) => {
      expect(lines[0]).toEqual({ id, status: 'attached', driverId: 'attach:1', generation });
      send({ type: 'get-executing' });
      await expect.poll(() => lines.find((line) => line['type'] === 'executing'), { timeout: 10_000 })
        .toEqual({ type: 'executing', executing: false });

      await stopSupervisedSession(id, root);
      await closed;
      stopped();
      await expect.poll(() => child()?.exitCode !== null || child()?.signalCode !== null, { timeout: 15_000 })
        .toBe(true);
    });
  }, 60_000);

  it('lists the sessions the runtime serves to an attached terminal, as it does to its WebSocket clients', async () => {
    const sessions = mkdtempSync(join(tmpdir(), 'rs-atp-sessions-'));
    try {
      await withAttachedRuntime('rs-atl-', { ROBOTA_TEST_SESSIONS_DIR: sessions }, 'drive', async ({ lines, send }) => {
        expect(lines[0]).toMatchObject({ status: 'attached' });
        send({ type: 'list-sessions', requestId: 'r1' });
        await expect.poll(() => lines.find((line) => line['requestId'] === 'r1'), { timeout: 10_000 })
          .toMatchObject({ type: 'sessions', requestId: 'r1', listing: { currentSessionId: expect.any(String) } });
      });
    } finally {
      rmSync(sessions, { recursive: true, force: true });
    }
  }, 60_000);
});
