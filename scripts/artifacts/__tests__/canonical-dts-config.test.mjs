import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('does not run two declaration emitters into the same canonical .d.ts path', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const files = execFileSync('git', ['ls-files', 'packages/**/tsdown.config.ts'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  const conflicts = files.filter((file) => {
    const config = readFileSync(path.join(root, file), 'utf8');
    return /dts:\s*['"]\.d\.ts['"]/u.test(config) && /format:\s*\['esm', 'cjs'\]/u.test(config);
  });
  expect(conflicts).toEqual([]);
});
