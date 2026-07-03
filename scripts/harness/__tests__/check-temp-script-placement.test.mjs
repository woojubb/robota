import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findParkedTempScripts } from '../check-temp-script-placement.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-temp-script-'));
  for (const relativePath of files) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '// temp\n', 'utf8');
  }
  return root;
}

describe('findParkedTempScripts (INFRA-023)', () => {
  it('flags temp-pattern files parked under packages/ and apps/', async () => {
    const root = await createFixture([
      'packages/agent-core/core-099-user-execution.ts',
      'packages/agent-cli/err-099-proxy.mjs',
      'apps/docs/x-mode.txt',
    ]);

    expect(findParkedTempScripts(root)).toEqual([
      'apps/docs/x-mode.txt',
      'packages/agent-cli/err-099-proxy.mjs',
      'packages/agent-core/core-099-user-execution.ts',
    ]);
  });

  it('ignores scratch/, node_modules, and dist output', async () => {
    const root = await createFixture([
      'scratch/src/core-099-user-execution.ts',
      'packages/agent-core/node_modules/x/y-user-execution.ts',
      'packages/agent-core/dist/z-user-execution.js',
      'packages/agent-core/src/robota.ts',
    ]);

    expect(findParkedTempScripts(root)).toEqual([]);
  });
});
