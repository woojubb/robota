import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openRegisteredControlStream } from '@robota-sdk/agent-local-host';
import { expect, it } from 'vitest';

import { startSupervisedControl } from '../supervised-session-control.js';

it('exposes a registration-validated carrier to both CLI and desktop hosts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-control-'));
  const id = '7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
  const server = await startSupervisedControl({ root, id, onStop: () => {} });
  try {
    const record = JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')) as { generation: string };
    await expect(openRegisteredControlStream(root, id, 'A'.repeat(22))).rejects.toThrow(/changed/i);
    const aborter = new AbortController();
    aborter.abort();
    await expect(openRegisteredControlStream(root, id, record.generation, aborter.signal)).rejects.toThrow();
    const stream = await openRegisteredControlStream(root, id, record.generation);
    try {
      await new Promise<void>((resolve, reject) => {
        stream.once('connect', resolve);
        stream.once('error', reject);
      });
    } finally { stream.destroy(); }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);


it.skipIf(process.platform === 'win32')('refuses a linked registration in the shared carrier', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-control-link-'));
  const id = '7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
  const server = await startSupervisedControl({ root, id, onStop: () => {} });
  const file = join(root, id, 'state.json');
  const original = join(root, id, 'state.original');
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as { generation: string };
    renameSync(file, original);
    symlinkSync(original, file);
    try { await expect(openRegisteredControlStream(root, id, record.generation)).rejects.toThrow(/refused/i); }
    finally { unlinkSync(file); renameSync(original, file); }
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
