import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const preload = fileURLToPath(new URL('../../testing/spawn-recorder.mjs', import.meta.url));

function run(program: string) {
  return spawnSync(process.execPath, ['--import', preload, '--eval', program], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'pipe'], timeout: 10_000,
  });
}

it('rejects a child started while descriptor 4 is still open', () => {
  const result = run("require('node:child_process').spawnSync(process.execPath, ['--version'])");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('A child was started before the spawner pair closed.');
});

it('allows a child after descriptor 4 closes', () => {
  const result = run("require('node:fs').closeSync(4); const child = require('node:child_process').spawnSync(process.execPath, ['--version']); if (child.status !== 0) process.exit(1)");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain('TEST_SPAWNER_PAIR_CLOSED');
});
