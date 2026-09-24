import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listFrameworkProjectContributionPaths } from '@robota-sdk/agent-framework';

import { ROBOTA_AGENT_DEFINITION_ROOTS } from '../product/robota-agent-roots.js';
import { ROBOTA_PROJECT_SETTINGS } from '../product/robota-project-settings.js';
import { ROBOTA_SKILL_ROOTS } from '../product/robota-skill-roots.js';
import { listProjectContributionPaths } from './project-contribution-preview.js';

describe('agent definition source preview', () => {
  it('lists the CLI roots that become readable after trust, while neutral framework has none', () => {
    const expectedRoots = [
      join('.robota', 'agents'),
      join('.agents', 'agents'),
      join('.claude', 'agents'),
    ];
    expect(ROBOTA_AGENT_DEFINITION_ROOTS).toEqual(expectedRoots);
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('agent:')))
      .toEqual([]);
    expect(listProjectContributionPaths('').filter((path) => path.id.startsWith('agent:'))).toEqual(
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
      join('.robota', 'settings.json'),
      join('.robota', 'settings.local.json'),
      join('.claude', 'settings.json'),
      join('.claude', 'settings.local.json'),
    ];
    expect(ROBOTA_PROJECT_SETTINGS.map((path) => path.relativePath)).toEqual(expectedPaths);
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('settings:')))
      .toEqual([]);
    expect(listProjectContributionPaths('').filter((path) => path.id.startsWith('settings:'))).toEqual(
      expectedPaths.map((relativePath) => ({
        id: `settings:${relativePath}`,
        label: 'Project settings and hooks',
        relativePath,
        expectedKind: 'file',
      })),
    );
  });
});

describe('skill source preview', () => {
  it('uses the exact product roots passed to framework discovery', () => {
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('skill:')))
      .toEqual([]);
    expect(listProjectContributionPaths('').filter((path) => path.id.startsWith('skill:'))).toEqual(
      ROBOTA_SKILL_ROOTS.map(({ root, kind }) => ({
        id: `skill:${root}`,
        label: kind === 'commands' ? 'Project commands' : 'Project skills',
        relativePath: root,
        expectedKind: 'directory',
      })),
    );
  });
});
