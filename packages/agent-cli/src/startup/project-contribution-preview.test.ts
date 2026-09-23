import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listFrameworkProjectContributionPaths } from '@robota-sdk/agent-framework';

import { ROBOTA_AGENT_DEFINITION_ROOTS } from '../product/robota-agent-roots.js';
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
