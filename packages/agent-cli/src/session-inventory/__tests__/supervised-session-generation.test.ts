import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
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
const PR = 'https://github.com/team/repo/pull/7';

function registration(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, ID, 'state.json'), 'utf8')) as Record<string, unknown>;
}

function rewriteRegistration(
  root: string,
  change: (record: Record<string, unknown>) => Record<string, unknown>,
): void {
  writeFileSync(join(root, ID, 'state.json'), JSON.stringify(change(registration(root))));
}

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

interface IControlContext {
  readonly root: string;
  readonly onStop: ReturnType<typeof vi.fn>;
  readonly onRename: ReturnType<typeof vi.fn>;
  readonly setPr: ReturnType<typeof vi.fn>;
}

async function withControl(prefix: string, run: (context: IControlContext) => Promise<void>): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const root = join(scratch, 'supervised');
  const onStop = vi.fn();
  const onRename = vi.fn();
  const setPr = vi.fn();
  const control = await startSupervisedControl(
    ID, onStop, root, () => 'idle', undefined, undefined, () => 'Name', onRename,
    { get: () => parseSupervisedPr(PR), set: setPr },
  );
  try {
    await run({ root, onStop, onRename, setPr });
  } finally {
    await control.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('supervised registration generation', () => {
  it('records a random generation per start, echoes it, and refuses any other generation', async () => {
    await withControl('rs-gen-', async ({ root, onStop, onRename, setPr }) => {
      const generation = registration(root)['generation'];
      expect(generation).toMatch(/^[A-Za-z0-9_-]{22}$/u);
      expect(await raw(root, { command: 'status', id: ID, generation })).toMatchObject({
        id: ID, status: 'running', generation,
      });
      const stale = 'A'.repeat(22);
      for (const frame of [
        { command: 'status', id: ID, generation: stale },
        { command: 'stop', id: ID, generation: stale },
        { command: 'stop', id: ID },
        { command: 'rename', id: ID, name: 'Other', generation: stale },
        { command: 'link-pr', id: ID, url: PR, generation: stale },
        { command: 'unlink-pr', id: ID, generation: stale },
      ]) {
        expect(await raw(root, frame)).toEqual({
          id: ID, status: 'refused', reason: 'stale-generation', generation,
        });
      }
      expect(onStop).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
      expect(setPr).not.toHaveBeenCalled();
    });
  });

  it('gives a restarted session at the same id a new generation that old rows cannot act on', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-regen-'));
    const root = join(scratch, 'supervised');
    const onStop = vi.fn();
    const onRename = vi.fn();
    const setPr = vi.fn();
    const start = (): ReturnType<typeof startSupervisedControl> => startSupervisedControl(
      ID, onStop, root, () => 'idle', undefined, undefined, undefined, onRename,
      { get: () => undefined, set: setPr },
    );
    let control = await start();
    try {
      const [before] = await listSupervisedSessions(root, undefined, { includeGeneration: true });
      expect(before?.generation).toBe(registration(root)['generation']);
      await control.close();
      control = await start();
      const [after] = await listSupervisedSessions(root, undefined, { includeGeneration: true });
      expect(after?.control).toBe('available');
      expect(after?.generation).toBe(registration(root)['generation']);
      expect(after?.generation).not.toBe(before?.generation);
      const old = before!.generation!;
      await expect(stopSupervisedSession(ID, root, old)).rejects.toThrow(/changed/i);
      await expect(renameSupervisedSession(ID, 'Other', root, old)).rejects.toThrow(/changed/i);
      await expect(linkSupervisedPr(ID, PR, root, old)).rejects.toThrow(/changed/i);
      await expect(unlinkSupervisedPr(ID, root, old)).rejects.toThrow(/changed/i);
      await expect(getVerifiedSupervisedPr(ID, root, old)).rejects.toThrow(/changed/i);
      expect(onStop).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
      expect(setPr).not.toHaveBeenCalled();
      await renameSupervisedSession(ID, 'Current', root, after!.generation);
      expect(onRename).toHaveBeenCalledExactlyOnceWith('Current');
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('reports a registration replaced under the same id as unavailable, and its owner refuses actions', async () => {
    await withControl('rs-repl-', async ({ root, onStop, onRename, setPr }) => {
      rewriteRegistration(root, (record) => ({ ...record, generation: 'B'.repeat(22) }));
      expect(
        await listSupervisedSessions(root, undefined, { includeGeneration: true, includeName: true }),
      ).toEqual([{ id: ID, liveness: 'alive', control: 'unavailable', activity: 'unknown' }]);
      await expect(stopSupervisedSession(ID, root)).rejects.toThrow();
      await expect(renameSupervisedSession(ID, 'Other', root)).rejects.toThrow();
      await expect(linkSupervisedPr(ID, PR, root)).rejects.toThrow();
      await expect(unlinkSupervisedPr(ID, root)).rejects.toThrow();
      await expect(getVerifiedSupervisedPr(ID, root)).rejects.toThrow();
      expect(onStop).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
      expect(setPr).not.toHaveBeenCalled();
    });
  });

  it('lists a registration without a generation but never controls it', async () => {
    await withControl('rs-legacy-', async ({ root, onStop, onRename }) => {
      rewriteRegistration(root, ({ generation: _omitted, ...record }) => record);
      expect(await listSupervisedSessions(root, undefined, { includeGeneration: true })).toEqual([
        { id: ID, liveness: 'alive', control: 'unavailable', activity: 'unknown' },
      ]);
      await expect(stopSupervisedSession(ID, root)).rejects.toThrow();
      await expect(renameSupervisedSession(ID, 'Other', root)).rejects.toThrow();
      expect(onStop).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
    });
  });

  it('keeps the generation out of ordinary rows', async () => {
    await withControl('rs-hide-', async ({ root }) => {
      const generation = String(registration(root)['generation']);
      const rows = await listSupervisedSessions(root, undefined, {
        includeName: true, includeCwd: true, includePr: true,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty('generation');
      expect(JSON.stringify(rows)).not.toContain(generation);
    });
  });
});
