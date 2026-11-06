import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProcessStartTime } from '@robota-sdk/agent-core/node';
import { afterEach, expect, it } from 'vitest';

import { listRegisteredCandidates } from '../registered-candidates.js';
import { readWindowsProcessStartTime } from '../windows-security.js';

const roots: string[] = [];
const ids = ['1bf9bc27-d773-4e88-b88f-f7a43e9eb1f4', '2bf9bc27-d773-4e88-b88f-f7a43e9eb1f4'];
const generation = 'AAAAAAAAAAAAAAAAAAAAAA';
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'candidate-inventory-')));
  roots.push(root);
  const startedAt = readProcessStartTime(process.pid, { readWindows: readWindowsProcessStartTime });
  if (!startedAt) throw new Error('Cannot establish synthetic process identity.');
  const write = (id: string, data: unknown) => {
    const directory = join(root, id);
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(directory, 'state.json'), JSON.stringify(data), { mode: 0o600 });
  };
  return { root, startedAt, write };
}

it('lists every registration in order without trusting public daemon metadata', async () => {
  const f = fixture();
  f.write(ids[1]!, { id: ids[1], pid: process.pid, startedAt: f.startedAt, generation, daemon: false, cwd: '/forged' });
  f.write(ids[0]!, { id: ids[0], pid: process.pid, startedAt: f.startedAt, generation, daemon: true, cwd: '/forged' });
  const rows = await listRegisteredCandidates(f.root);
  expect(rows.map((row) => row.id)).toEqual(ids);
  expect(rows).toEqual(ids.map((id) => ({ id, generation, liveness: 'alive', control: 'unprobed', activity: 'unknown' })));
});

it('retains invalid and legacy registrations as unproved candidates', async () => {
  const f = fixture();
  f.write(ids[0]!, { id: ids[0], pid: process.pid, startedAt: f.startedAt });
  f.write(ids[1]!, { id: ids[1], pid: 'invalid', startedAt: f.startedAt, generation });
  const rows = await listRegisteredCandidates(f.root);
  expect(rows[0]).toMatchObject({ id: ids[0], liveness: 'alive', control: 'unavailable' });
  expect(rows[0]).not.toHaveProperty('generation');
  expect(rows[1]).toMatchObject({ id: ids[1], liveness: 'unknown', control: 'unavailable', problem: 'invalid-registration' });
});

it.skipIf(process.platform === 'win32')('refuses linked registration files rather than hiding the candidate', async () => {
  const f = fixture();
  f.write(ids[0]!, { id: ids[0], pid: process.pid, startedAt: f.startedAt, generation });
  const original = join(f.root, ids[0]!, 'state.json');
  const copy = join(f.root, 'record-copy');
  writeFileSync(copy, readFileSync(original), { mode: 0o600 });
  rmSync(original);
  symlinkSync(copy, original);
  const rows = await listRegisteredCandidates(f.root);
  expect(rows).toEqual([expect.objectContaining({ id: ids[0], liveness: 'unknown', control: 'unavailable', problem: 'invalid-registration' })]);
});

it('does not enumerate when already cancelled', async () => {
  const f = fixture();
  const aborter = new AbortController();
  aborter.abort();
  await expect(listRegisteredCandidates(f.root, aborter.signal)).rejects.toThrow();
});

it('stops enumeration when cancelled before the next registration is read', async () => {
  const f = fixture();
  f.write(ids[0]!, { id: ids[0], pid: process.pid, startedAt: f.startedAt, generation });
  const aborter = new AbortController();
  const pending = listRegisteredCandidates(f.root, aborter.signal);
  queueMicrotask(() => aborter.abort());
  await expect(pending).rejects.toThrow();
});

it('refuses an oversized registry rather than truncating candidates', async () => {
  const f = fixture();
  for (let count = 0; count < 257; count++) {
    const id = `${count.toString(16).padStart(8, '0')}-d773-4e88-b88f-f7a43e9eb1f4`;
    mkdirSync(join(f.root, id), { mode: 0o700 });
  }
  await expect(listRegisteredCandidates(f.root)).rejects.toThrow(/too many/i);
});
