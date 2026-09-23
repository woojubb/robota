import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import {
  inspectPreTrustProjectPaths,
  listFrameworkProjectContributionPaths,
} from '@robota-sdk/agent-framework';

import { COST_BUDGET_FILE } from './cost-budget-adapter.js';
import { projectOutputStyleDirectories } from './output-style-sources.js';

import type { IProjectContributionPath, IWorkspaceIdentity } from '@robota-sdk/agent-framework';

function currentWorkspaceDirectory(identity: IWorkspaceIdentity, cwd: string): string | undefined {
  try {
    const remainder = relative(identity.worktreeRoot, realpathSync(cwd));
    if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
      return undefined;
    }
    return remainder;
  } catch {
    return undefined;
  }
}

/** CLI-owned sources extend the framework owners without copying their path definitions. */
export function listProjectContributionPaths(cwdRelative: string): readonly IProjectContributionPath[] {
  return [
    ...listFrameworkProjectContributionPaths(cwdRelative),
    ...projectOutputStyleDirectories(cwdRelative).map((relativePath) => ({
      id: `output-style:${relativePath}`,
      label: 'Project output styles',
      relativePath,
      expectedKind: 'directory' as const,
    })),
    {
      id: 'cost-budget',
      label: 'Project cost budget',
      relativePath: COST_BUDGET_FILE,
      expectedKind: 'file',
    },
  ];
}

/** Candidate sources are listed even when absent; no project content is read or followed. */
export function formatProjectContributionPreview(
  identity: IWorkspaceIdentity | undefined,
  cwd: string,
): string {
  if (identity === undefined) return 'Project sources: unavailable (workspace identity unresolved)\n';
  const cwdRelative = currentWorkspaceDirectory(identity, cwd);
  if (cwdRelative === undefined) {
    return 'Project sources: unavailable (working directory is outside the workspace)\n';
  }
  const descriptors = listProjectContributionPaths(cwdRelative);
  const inspected = inspectPreTrustProjectPaths(
    identity,
    descriptors.map((descriptor) => descriptor.relativePath),
  );
  const rows = descriptors.map((descriptor, index) => {
    const kind = inspected[index]?.kind ?? 'unavailable';
    return `  [${kind}] ${descriptor.relativePath} — ${descriptor.label}`;
  });
  return [
    'Project sources (metadata only; content not read):',
    ...rows,
    'Settings may replace the default task-context directory after trust; hooks, providers, and MCP settings are fields within the listed sources.',
    '',
  ].join('\n');
}
