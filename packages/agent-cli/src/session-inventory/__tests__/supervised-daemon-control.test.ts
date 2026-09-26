import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  connectSupervisedDaemon,
  listSupervisedSessions,
  startSupervisedControl,
  type ISupervisedDaemon,
} from '../supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const URL_WITH_TOKEN = 'ws://127.0.0.1:43127?token=0123456789abcdef';

async function raw(root: string, frame: Record<string, unknown>): Promise<Record<string, unknown>> {
  const socketName = readdirSync(root).find((name) => name.endsWith('.sock'))!;
  const client = createConnection(join(root, socketName));
  try {
    await new Promise<void>((resolve) => client.once('connect', resolve));
    client.setEncoding('utf8');
    client.write(`${JSON.stringify(frame)}\n`);
    let received = '';
    await new Promise<void>((resolve) => {
      client.on('data', (chunk: string) => {
        received += chunk;
        if (received.includes('\n')) resolve();
      });
    });
    return JSON.parse(received.slice(0, received.indexOf('\n'))) as Record<string, unknown>;
  } finally {
    client.destroy();
  }
}

async function withControl(
  daemon: ISupervisedDaemon | undefined,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'rs-dmn-'));
  const root = join(scratch, 'supervised');
  const control = await startSupervisedControl(
    ID, () => undefined, root, () => 'idle', () => '/work/project', undefined, undefined, undefined,
    undefined, undefined, undefined, daemon,
  );
  try {
    await run(root);
  } finally {
    await control.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

function generationOf(root: string): string {
  return (JSON.parse(readFileSync(join(root, ID, 'state.json'), 'utf8')) as { generation: string }).generation;
}

describe('supervised daemon control', () => {
  it('hands a daemon its WebSocket URL through the verified generation, and marks it in status', async () => {
    await withControl({ url: () => URL_WITH_TOKEN }, async (root) => {
      expect(await connectSupervisedDaemon(ID, root)).toBe(URL_WITH_TOKEN);
      expect(await connectSupervisedDaemon(ID, root, generationOf(root))).toBe(URL_WITH_TOKEN);
      expect(await listSupervisedSessions(root, undefined, { includeDaemon: true })).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'idle', daemon: true },
      ]);
      // Status never carries the URL: only `connect` does.
      const status = await raw(root, { command: 'status', id: ID, generation: generationOf(root) });
      expect(status).toMatchObject({ status: 'running', daemon: true });
      expect(JSON.stringify(status)).not.toContain('token');
      expect(JSON.stringify(await listSupervisedSessions(root, undefined, { includeDaemon: true })))
        .not.toContain('token');
    });
  });

  it('refuses connect on a session that is not a daemon, and marks none in status', async () => {
    await withControl(undefined, async (root) => {
      await expect(connectSupervisedDaemon(ID, root)).rejects.toThrow(/daemon connection/);
      expect(await raw(root, { command: 'connect', id: ID, generation: generationOf(root) }))
        .toEqual({ id: ID, status: 'refused', generation: generationOf(root) });
      expect(await listSupervisedSessions(root, undefined, { includeDaemon: true })).toEqual([
        { id: ID, liveness: 'alive', control: 'available', activity: 'idle' },
      ]);
    });
  });

  it('refuses connect bound to any other generation without revealing the URL', async () => {
    await withControl({ url: () => URL_WITH_TOKEN }, async (root) => {
      await expect(connectSupervisedDaemon(ID, root, 'A'.repeat(22))).rejects.toThrow(/changed since/);
      const reply = await raw(root, { command: 'connect', id: ID, generation: 'B'.repeat(22) });
      expect(reply).toEqual({ id: ID, status: 'refused', reason: 'stale-generation' });
      expect(await raw(root, { command: 'connect', id: ID })).toEqual({
        id: ID, status: 'refused', reason: 'stale-generation',
      });
    });
  });

  it('refuses connect while no loopback URL can be read', async () => {
    for (const url of [
      () => undefined,
      () => 'ws://example.com:80?token=x',
      () => 'http://127.0.0.1:80',
      () => { throw new Error('not bound'); },
    ]) {
      await withControl({ url }, async (root) => {
        await expect(connectSupervisedDaemon(ID, root)).rejects.toThrow(/daemon connection/);
      });
    }
  });
});
