import { describe, expect, it } from 'vitest';

import { listFrameworkProjectContributionPaths } from './project-contribution-inventory.js';

describe('project contribution inventory', () => {
  it('includes every fixed project detector input as an owner-declared file', () => {
    const paths = listFrameworkProjectContributionPaths('');
    for (const relativePath of [
      'package.json',
      'tsconfig.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lockb',
      'package-lock.json',
      'pyproject.toml',
      'setup.py',
      'Cargo.toml',
      'go.mod',
    ]) {
      expect(paths).toContainEqual(expect.objectContaining({ relativePath, expectedKind: 'file' }));
    }
  });
});
