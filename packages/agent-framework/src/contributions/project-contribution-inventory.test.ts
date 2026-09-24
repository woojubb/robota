import { describe, expect, it } from 'vitest';

import { listFrameworkProjectContributionPaths } from './project-contribution-inventory.js';
import { TEST_SKILL_ROOTS } from '../testing/contribution-source-fixture.js';

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

  it('lists only the host-selected skill roots', () => {
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('skill:')))
      .toEqual([]);
    expect(
      listFrameworkProjectContributionPaths('', TEST_SKILL_ROOTS).filter((path) =>
        path.id.startsWith('skill:'),
      ),
    ).toEqual(
      TEST_SKILL_ROOTS.map(({ root, kind }) => ({
        id: `skill:${root}`,
        label: kind === 'commands' ? 'Project commands' : 'Project skills',
        relativePath: root,
        expectedKind: 'directory',
      })),
    );
  });
});
