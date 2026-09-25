import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  inspectPreTrustProjectPaths,
  listFrameworkProjectContributionPaths,
} from '@robota-sdk/agent-framework';

import { COST_BUDGET_FILE } from './cost-budget-adapter.js';
import { projectOutputStyleDirectories } from './output-style-sources.js';
import { ROBOTA_AGENT_DEFINITION_ROOTS } from '../product/robota-agent-roots.js';
import { ROBOTA_PROJECT_SETTINGS } from '../product/robota-project-settings.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../product/robota-project-state-directories.js';
import { ROBOTA_PLUGIN_DIRECTORY } from '../product/robota-plugin-paths.js';
import { ROBOTA_SKILL_ROOTS } from '../product/robota-skill-roots.js';
import { ROBOTA_TASK_CONTEXT } from '../product/robota-task-context.js';

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
export function listProjectContributionPaths(
  cwdRelative: string,
  taskContext: { readonly enabled?: boolean; readonly dir?: string } = ROBOTA_TASK_CONTEXT,
): readonly IProjectContributionPath[] {
  return [
    ...listFrameworkProjectContributionPaths(cwdRelative, ROBOTA_SKILL_ROOTS, taskContext),
    ...Object.entries(ROBOTA_PROJECT_STATE_DIRECTORIES).map(([namespace, relativePath]) => ({
      id: `state:${namespace}`,
      label: `Project ${namespace}`,
      relativePath,
      expectedKind: 'directory' as const,
    })),
    ...ROBOTA_PROJECT_SETTINGS.map(({ relativePath }) => ({
      id: `settings:${relativePath}`,
      label: 'Project settings and hooks',
      relativePath,
      expectedKind: 'file' as const,
    })),
    ...ROBOTA_AGENT_DEFINITION_ROOTS.map((relativePath) => ({
      id: `agent:${relativePath}`,
      label: 'Project agent definitions',
      relativePath,
      expectedKind: 'directory' as const,
    })),
    {
      id: 'plugins',
      label: 'Project plugins and plugin hooks',
      relativePath: join(cwdRelative, ROBOTA_PLUGIN_DIRECTORY),
      expectedKind: 'directory',
    },
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
  taskContext: { readonly enabled?: boolean; readonly dir?: string } = ROBOTA_TASK_CONTEXT,
): string {
  if (identity === undefined)
    return 'Project sources: unavailable (workspace identity unresolved)\n';
  const cwdRelative = currentWorkspaceDirectory(identity, cwd);
  if (cwdRelative === undefined) {
    return 'Project sources: unavailable (working directory is outside the workspace)\n';
  }
  const descriptors = listProjectContributionPaths(cwdRelative, taskContext);
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
