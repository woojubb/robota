import { createTestProductRuntime } from '../__tests__/helpers/product-runtime.js';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listFrameworkProjectContributionPaths } from '@robota-sdk/agent-framework';

import { productAgentDefinitionRoots } from '../product/agent-roots.js';
import { productProjectSettings } from '../product/project-settings.js';
import { productProjectStateDirectories } from '../product/project-state-directories.js';
import { productSkillRoots } from '../product/skill-roots.js';
import { listProjectContributionPaths } from './project-contribution-preview.js';
const PRODUCT_AGENT_DEFINITION_ROOTS = productAgentDefinitionRoots(createTestProductRuntime());
const PRODUCT_PROJECT_SETTINGS = productProjectSettings(createTestProductRuntime());
const PRODUCT_PROJECT_STATE_DIRECTORIES = productProjectStateDirectories(createTestProductRuntime());
const PRODUCT_SKILL_ROOTS = productSkillRoots(createTestProductRuntime());


describe('agent definition source preview', () => {
  it('lists the CLI roots that become readable after trust, while neutral framework has none', () => {
    const expectedRoots = [
      join('.test-product', 'agents'),
      join('.agents', 'agents'),
      join('.claude', 'agents'),
    ];
    expect(PRODUCT_AGENT_DEFINITION_ROOTS).toEqual(expectedRoots);
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('agent:')))
      .toEqual([]);
    expect(listProjectContributionPaths('', createTestProductRuntime()).filter((path) => path.id.startsWith('agent:'))).toEqual(
      expectedRoots.map((relativePath) => ({
        id: `agent:${relativePath}`,
        label: 'Project agent definitions',
        relativePath,
        expectedKind: 'directory',
      })),
    );
  });
});

describe('project settings source preview', () => {
  it('lists the CLI settings layers that become readable after trust', () => {
    const expectedPaths = [
      join('.test-product', 'settings.json'),
      join('.test-product', 'settings.local.json'),
      join('.claude', 'settings.json'),
      join('.claude', 'settings.local.json'),
    ];
    expect(PRODUCT_PROJECT_SETTINGS.map((path) => path.relativePath)).toEqual(expectedPaths);
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('settings:')))
      .toEqual([]);
    expect(listProjectContributionPaths('', createTestProductRuntime()).filter((path) => path.id.startsWith('settings:'))).toEqual(
      expectedPaths.map((relativePath) => ({
        id: `settings:${relativePath}`,
        label: 'Project settings and hooks',
        relativePath,
        expectedKind: 'file',
      })),
    );
  });
});

describe('project state source preview', () => {
  it('uses the CLI state roots while neutral framework inventory has no product state paths', () => {
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('state:')))
      .toEqual([]);
    expect(listProjectContributionPaths('', createTestProductRuntime()).filter((path) => path.id.startsWith('state:'))).toEqual(
      Object.entries(PRODUCT_PROJECT_STATE_DIRECTORIES).map(([namespace, relativePath]) => ({
        id: `state:${namespace}`,
        label: `Project ${namespace}`,
        relativePath,
        expectedKind: 'directory',
      })),
    );
  });
});

describe('skill source preview', () => {
  it('uses the exact product roots passed to framework discovery', () => {
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('skill:')))
      .toEqual([]);
    expect(listProjectContributionPaths('', createTestProductRuntime()).filter((path) => path.id.startsWith('skill:'))).toEqual(
      PRODUCT_SKILL_ROOTS.map(({ root, kind }) => ({
        id: `skill:${root}`,
        label: kind === 'commands' ? 'Project commands' : 'Project skills',
        relativePath: root,
        expectedKind: 'directory',
      })),
    );
  });
});

describe('task-context source preview', () => {
  it('uses the same explicit enabled/custom root and omits a disabled root', () => {
    expect(
      listProjectContributionPaths('', createTestProductRuntime(), { enabled: true, dir: 'custom/tasks' }).filter((path) =>
        path.id.startsWith('tasks:'),
      ),
    ).toEqual([
      {
        id: 'tasks:custom/tasks',
        label: 'Active task context',
        relativePath: 'custom/tasks',
        expectedKind: 'directory',
      },
    ]);
    expect(
      listProjectContributionPaths('', createTestProductRuntime(), { enabled: false, dir: 'custom/tasks' }).filter((path) =>
        path.id.startsWith('tasks:'),
      ),
    ).toEqual([]);
  });
});
