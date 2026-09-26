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

describe('attach to a detached supervised runtime', () => {
  it('streams the session protocol over the control socket and ends when the session stops', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-atp-'));
    const root = join(scratch, 'supervised');
    let id: string | undefined;
    let child: ChildProcess | undefined;
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
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
      socket.write(`${JSON.stringify({ command: 'attach', id, generation, mode: 'observe', protocol: 1 })}\n`);
      await expect.poll(() => lines.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(lines[0]).toEqual({ id, status: 'attached', driverId: 'attach:1', generation });
      socket.write(`${JSON.stringify({ type: 'get-executing' })}\n`);
      await expect.poll(() => lines.find((line) => line['type'] === 'executing'), { timeout: 10_000 })
        .toEqual({ type: 'executing', executing: false });

      await stopSupervisedSession(id, root);
      await closed;
      id = undefined;
      await expect.poll(() => child?.exitCode !== null || child?.signalCode !== null, { timeout: 15_000 })
        .toBe(true);
    } finally {
      if (id) {
        try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});
