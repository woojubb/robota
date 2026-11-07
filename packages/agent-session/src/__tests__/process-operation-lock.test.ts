import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, expect, it } from 'vitest';

import { createProcessOperationLock } from '../process-operation-lock.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'process-operation-lock-'));
  roots.push(root);
  return root;
}

it('excludes a second owner for the same id, but not a different id', () => {
  const root = directory();
  const first = createProcessOperationLock(root);
  const second = createProcessOperationLock(root);
  const held = first.tryAcquire('session_a');
  expect(held).toBeDefined();
  expect(second.tryAcquire('session_a')).toBeUndefined();
  const other = second.tryAcquire('session_b');
  expect(other).toBeDefined();
  other?.release();
  held?.release();
  held?.release();
  const again = second.tryAcquire('session_a');
  expect(again).toBeDefined();
  again?.release();
});

it('recovers a guard after its owning OS process is killed', async () => {
  const root = directory();
  const source = pathToFileURL(
    fileURLToPath(new URL('../process-operation-lock.ts', import.meta.url)),
  ).href;
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const program = `import { createProcessOperationLock } from ${JSON.stringify(source)}; const held = createProcessOperationLock(process.argv[1]).tryAcquire('session_a'); if (!held) process.exit(2); process.send('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(
    process.execPath,
    ['--import', tsx, '--conditions=source', '--input-type=module', '-e', program, root],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  try {
    expect((await once(child, 'message', { signal: AbortSignal.timeout(10_000) }))[0]).toBe(
      'ready',
    );
    const lock = createProcessOperationLock(root);
    expect(lock.tryAcquire('session_a')).toBeUndefined();
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) });
    child.kill('SIGKILL');
    await exited;
    const recovered = lock.tryAcquire('session_a');
    expect(recovered).toBeDefined();
    recovered?.release();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}, 20_000);

it.runIf(process.platform !== 'win32')('refuses a symlink without modifying its target', () => {
  const root = directory();
  const target = join(root, 'target');
  writeFileSync(target, 'keep');
  symlinkSync(target, join(root, 'session_a.guard'));
  expect(() => createProcessOperationLock(root).tryAcquire('session_a')).toThrow();
  expect(readFileSync(target, 'utf8')).toBe('keep');
});
