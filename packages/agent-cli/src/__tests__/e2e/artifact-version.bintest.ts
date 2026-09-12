import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

it('reports the package version through both the launcher and the physical generated entry', () => {
  const packageRoot = new URL('../../../', import.meta.url);
  const manifest: { version: string } = JSON.parse(
    readFileSync(new URL('package.json', packageRoot), 'utf8'),
  );
  const entries = [
    fileURLToPath(new URL('bin/robota.cjs', packageRoot)),
    realpathSync(fileURLToPath(new URL('dist/node/bin.js', packageRoot))),
  ];
  for (const entry of entries) {
    expect(execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim()).toBe(
      `robota ${manifest.version}`,
    );
  }
});
