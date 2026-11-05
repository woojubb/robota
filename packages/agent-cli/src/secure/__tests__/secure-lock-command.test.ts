import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { listSupervisedSessions, lockSupervisedSession, resolveSupervisedDirectory, startSupervisedControl, type ISupervisedControl } from '../../session-inventory/supervised-session-control.js';
import { runSecureCommand } from '../secure-command.js';

const controls: ISupervisedControl[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const control of controls.splice(0)) await control.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('locks every reachable secure runtime without a terminal and leaves plain runtimes alone', async () => {
  const home = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'sl-')));
  roots.push(home);
  const runtime = createTestProductRuntime('test-product', { HOME: home });
  const root = resolveSupervisedDirectory(runtime);
  const lockOne = vi.fn();
  const lockTwo = vi.fn();
  for (const [id, lock] of [['7bf9bc27-d773-4e88-b88f-f7a43e9eb1f4', lockOne], ['a9a8bc27-d773-4e88-b88f-f7a43e9eb1f4', lockTwo]] as const) {
    controls.push(await startSupervisedControl({ id, root, onStop: () => {}, admission: () => ({
      serveLink: () => {}, lock, status: () => ({ certified: true, daemon: false, restricted: false }), takeDaemonRole: () => false,
    }) }));
  }
  controls.push(await startSupervisedControl({ id: 'b9a8bc27-d773-4e88-b88f-f7a43e9eb1f4', root, onStop: () => {} }));
  const output: string[] = [];
  const errors: string[] = [];
  const openTerminal = vi.fn(() => { throw new Error('Unexpected terminal'); });
  const code = await runSecureCommand(['lock'], { productRuntime: runtime, stdout: (s) => output.push(s), stderr: (s) => errors.push(s), stdinIsTTY: false, openTerminal });
  expect(code, errors.join('')).toBe(0);
  expect(lockOne).toHaveBeenCalledOnce();
  expect(lockTwo).toHaveBeenCalledOnce();
  expect(openTerminal).not.toHaveBeenCalled();
  const rows = await listSupervisedSessions(root, undefined, { includeGeneration: true });
  const plain = rows.find((row) => row.id.startsWith('b9a8'));
  if (!plain?.generation) throw new Error('Missing plain registration');
  await expect(lockSupervisedSession(plain.id, root, plain.generation)).rejects.toThrow(/confirm locking/i);
  await expect(lockSupervisedSession(plain.id, root, 'A'.repeat(22))).rejects.toThrow(/changed/i);
  mkdirSync(join(root, 'c9a8bc27-d773-4e88-b88f-f7a43e9eb1f4'));
  const incomplete = await runSecureCommand(['lock'], { productRuntime: runtime, stdout: (s) => output.push(s), stderr: (s) => errors.push(s), stdinIsTTY: false, openTerminal });
  expect(incomplete).toBe(1);
  expect(errors.join('')).toMatch(/could not confirm locking/i);
  expect(lockOne).toHaveBeenCalledTimes(2);
  expect(lockTwo).toHaveBeenCalledTimes(2);
});
