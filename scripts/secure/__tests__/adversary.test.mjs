import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../adversary.mjs', import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--conditions=source', script, ...args], {
    encoding: 'utf8', timeout: 30_000,
  });
}

describe.skipIf(process.platform === 'win32')('the same-user adversary against real runtimes', () => {
  it('is refused by the secure runtime', () => {
    const result = run();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('secure runtime refused plain connect');
    expect(result.stdout).toContain('replay into a second runtime');
    expect(result.stdout).toContain('swapped-key grant reported mismatch');
    expect(result.stdout).toContain('owner key opened a sealed turn');
    expect(result.stdout).toContain('an impostor received no proof');
    expect(result.stdout).toContain('external-event start was refused');
  }, 40_000);

  it('catches the open control socket of a plain runtime as its negative control', () => {
    const result = run('--plain-negative-control');
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('plain connect unexpectedly succeeded');
  }, 40_000);
});
