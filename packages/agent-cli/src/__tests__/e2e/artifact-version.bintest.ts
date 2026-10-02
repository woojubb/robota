import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';
import { createTestBinaryEnvironment } from '../helpers/product-runtime.js';

it('reports the package version through both the launcher and the physical generated entry', () => {
  const packageRoot = new URL('../../../', import.meta.url);
  const manifest: { version: string } = JSON.parse(
    readFileSync(new URL('package.json', packageRoot), 'utf8'),
  );
  const entries = [
    fileURLToPath(new URL('bin/agent.cjs', packageRoot)),
    realpathSync(fileURLToPath(new URL('dist/node/bin.js', packageRoot))),
  ];
  const home = mkdtempSync(join(tmpdir(), 'agent-version-home-'));
  try {
    for (const entry of entries) {
      expect(execFileSync(process.execPath, [entry, '--version'], {
        encoding: 'utf8', env: createTestBinaryEnvironment(home),
      }).trim()).toBe(`test-product ${manifest.version}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
