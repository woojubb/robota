import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';
import { namesThisRepository } from '../../harness/check-publish-safety.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

it('publication scripts stop before package discovery when product scope is not configured', () => {
  for (const relativePath of [
    'scripts/publish/publish-packages.sh',
    'scripts/publish/configure-trusted-publishers.sh',
  ]) {
    const result = spawnSync('bash', [path.join(root, relativePath)], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PRODUCT_PACKAGE_SCOPE');
    expect(result.stdout).not.toContain('Building');
    expect(result.stdout).not.toContain('packages →');
  }
});

it('matches repository provenance only against the selected repository URL', () => {
  expect(namesThisRepository({ url: 'git+https://github.com/example-one/runtime.git' }, 'https://github.com/example-one/runtime')).toBe(true);
  expect(namesThisRepository({ url: 'https://github.com/example-two/runtime.git' }, 'https://github.com/example-one/runtime')).toBe(false);
  expect(namesThisRepository({ url: 'https://github.com/example-one/runtime' }, undefined)).toBe(false);
});
