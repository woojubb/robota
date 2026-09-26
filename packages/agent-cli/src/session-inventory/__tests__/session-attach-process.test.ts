import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { runSessionAttachCommand, type ISessionAttachCommandOptions } from '../session-attach-command.js';
import { listSupervisedSessions, stopSupervisedSession } from '../supervised-session-control.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

import type { TServerMessage } from '@robota-sdk/agent-transport';

const fixture = fileURLToPath(new URL('./fixtures/supervised-serve-fixture.ts', import.meta.url));

describe('attach to a detached supervised runtime from the CLI command', () => {
  it('submits, detaches without stopping it, and re-attaches to the same conversation', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-cp-'));
    const root = join(scratch, 'supervised');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let id: string | undefined;
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
      });
      const first: ISessionAttachCommandOptions['render'] = async ({ connection, driverId }) => {
        expect(driverId).toBe('attach:1');
        const frames: TServerMessage[] = [];
        connection.subscribe((frame) => frames.push(frame));
        connection.send({ type: 'submit', prompt: 'hello from the attached terminal' });
        // The fixture's model always fails, so the turn ends with an error rather than a reply.
        await vi.waitFor(
          () => expect(frames.some((frame) => frame.type === 'complete' || frame.type === 'error')).toBe(true),
          { timeout: 15_000 },
        );
        return 'user';
      };
      expect(await runSessionAttachCommand([id], {
        isTTY: true, root, confirm: async () => true, render: first,
      })).toBe(0);
      expect(await listSupervisedSessions(root)).toEqual([
        expect.objectContaining({ id, liveness: 'alive', control: 'available' }),
      ]);

      const again: ISessionAttachCommandOptions['render'] = async ({ connection, driverId, mode }) => {
        expect(mode).toBe('observe');
        expect(driverId).toBe('attach:2');
        const frames: TServerMessage[] = [];
        connection.subscribe((frame) => frames.push(frame));
        connection.send({ type: 'get-messages' });
        await vi.waitFor(() => {
          const snapshot = frames.find((frame) => frame.type === 'messages');
          expect(JSON.stringify(snapshot)).toContain('hello from the attached terminal');
        }, { timeout: 15_000 });
        return 'user';
      };
      expect(await runSessionAttachCommand([id, '--observe'], {
        isTTY: true, root, confirm: async () => true, render: again,
      })).toBe(0);
      await stopSupervisedSession(id, root);
      id = undefined;
    } finally {
      out.mockRestore();
      if (id) {
        try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});
