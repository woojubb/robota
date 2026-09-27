import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { listFrameworkProjectContributionPaths } from '@robota-sdk/agent-framework';

import { ROBOTA_AGENT_DEFINITION_ROOTS } from '../product/robota-agent-roots.js';
import { ROBOTA_PROJECT_SETTINGS } from '../product/robota-project-settings.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../product/robota-project-state-directories.js';
import { ROBOTA_SKILL_ROOTS } from '../product/robota-skill-roots.js';
import {
  formatProjectContributionPreview,
  listProjectContributionPaths,
} from './project-contribution-preview.js';

import type { IWorkspaceIdentity } from '@robota-sdk/agent-framework';

// #3282 §3: `inspectPreTrustProjectPaths` reports every path as `unavailable` unless run on Linux
// (see its own doc comment) — mocked so this file's assertions about which rows are SHOWN are
// deterministic on every CI platform, not conditional on which one happens to be running.
const { inspectPreTrustProjectPaths } = vi.hoisted(() => ({
  inspectPreTrustProjectPaths: vi.fn(),
}));
vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  return { ...actual, inspectPreTrustProjectPaths };
});

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

describe('project state source preview', () => {
  it('uses the CLI state roots while neutral framework inventory has no product state paths', () => {
    expect(listFrameworkProjectContributionPaths('').filter((path) => path.id.startsWith('state:')))
      .toEqual([]);
    expect(listProjectContributionPaths('').filter((path) => path.id.startsWith('state:'))).toEqual(
      Object.entries(ROBOTA_PROJECT_STATE_DIRECTORIES).map(([namespace, relativePath]) => ({
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

describe('task-context source preview', () => {
  it('uses the same explicit enabled/custom root and omits a disabled root', () => {
    expect(
      listProjectContributionPaths('', { enabled: true, dir: 'custom/tasks' }).filter((path) =>
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
      listProjectContributionPaths('', { enabled: false, dir: 'custom/tasks' }).filter((path) =>
        path.id.startsWith('tasks:'),
      ),
    ).toEqual([]);
  });
});

describe('#3282 §3 — formatProjectContributionPreview omits rows with an unknown state', () => {
  const identity: IWorkspaceIdentity = {
    repositoryKey: 'r',
    displayPath: process.cwd(),
    worktreeRoot: process.cwd(),
  };

  it('lists only rows whose kind is known, in the same order', () => {
    // Deliberately mixed and out of the descriptor list's own order, so a passing test cannot be an
    // accident of "everything happens to line up".
    inspectPreTrustProjectPaths.mockReturnValue(
      listProjectContributionPaths('').map((_descriptor, index) =>
        index % 3 === 0 ? { kind: 'unavailable' } : { kind: index % 3 === 1 ? 'absent' : 'directory' },
      ),
    );

    const text = formatProjectContributionPreview(identity, process.cwd());
    const rows = text.split('\n').filter((line) => line.startsWith('  ['));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((line) => !line.startsWith('  [unavailable]'))).toBe(true);
    expect(rows.some((line) => line.startsWith('  [absent]'))).toBe(true);
    expect(rows.some((line) => line.startsWith('  [directory]'))).toBe(true);
  });

  it('every row unknown (the non-Linux default) leaves no rows — no "[unavailable]" noise', () => {
    inspectPreTrustProjectPaths.mockImplementation((_identity: unknown, paths: readonly string[]) =>
      paths.map(() => ({ kind: 'unavailable' })),
    );

    const text = formatProjectContributionPreview(identity, process.cwd());

    expect(text.split('\n').some((line) => line.startsWith('  ['))).toBe(false);
  });
});
