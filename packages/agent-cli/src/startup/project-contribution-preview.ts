import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  inspectPreTrustProjectPaths,
  listFrameworkProjectContributionPaths,
} from '@robota-sdk/agent-framework';

import { costBudgetFile } from './cost-budget-adapter.js';
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
export function listProjectContributionPaths(
  cwdRelative: string,
  runtime: ICliRuntimeContext,
  taskContext: { readonly enabled?: boolean; readonly dir?: string } = runtime.layout.taskContext,
): readonly IProjectContributionPath[] {
  return [
    ...listFrameworkProjectContributionPaths(cwdRelative, runtime.layout.skillRoots, taskContext),
    ...Object.entries(runtime.layout.projectStateDirectories).map(([namespace, relativePath]) => ({
      id: `state:${namespace}`,
      label: `Project ${namespace}`,
      relativePath,
      expectedKind: 'directory' as const,
    })),
    ...runtime.layout.projectSettingsPaths.map(({ relativePath }) => ({
      id: `settings:${relativePath}`,
      label: 'Project settings and hooks',
      relativePath,
      expectedKind: 'file' as const,
    })),
    ...runtime.layout.agentDefinitionRoots.map((relativePath) => ({
      id: `agent:${relativePath}`,
      label: 'Project agent definitions',
      relativePath,
      expectedKind: 'directory' as const,
    })),
    {
      id: 'plugins',
      label: 'Project plugins and plugin hooks',
      relativePath: join(cwdRelative, runtime.layout.pluginRelativeDirectory),
      expectedKind: 'directory',
    },
    ...projectOutputStyleDirectories(cwdRelative, runtime).map((relativePath) => ({
      id: `output-style:${relativePath}`,
      label: 'Project output styles',
      relativePath,
      expectedKind: 'directory' as const,
    })),
    {
      id: 'cost-budget',
      label: 'Project cost budget',
      relativePath: costBudgetFile(runtime),
      expectedKind: 'file',
    },
  ];
}

/** Candidate sources are listed even when absent; no project content is read or followed. */
export function formatProjectContributionPreview(
  identity: IWorkspaceIdentity | undefined,
  cwd: string,
  runtime: ICliRuntimeContext,
  taskContext: { readonly enabled?: boolean; readonly dir?: string } = runtime.layout.taskContext,
): string {
  if (identity === undefined) return 'Project sources: unavailable (workspace identity unresolved)\n';
  const cwdRelative = currentWorkspaceDirectory(identity, cwd);
  if (cwdRelative === undefined) {
    return 'Project sources: unavailable (working directory is outside the workspace)\n';
  }
  const descriptors = listProjectContributionPaths(cwdRelative, runtime, taskContext);
  const inspected = inspectPreTrustProjectPaths(
    identity,
    descriptors.map((descriptor) => descriptor.relativePath),
  );
  // Full candidate list, every row's inspected state included as-is — a terminal reader (plain
  // `the product trust status`, the TUI's own interactive prompt) sees the complete picture. #3282 §3
  // trims this down for `--json`/the GUI dialog specifically, in `trustQuestionFor` below — those
  // audiences want "what would this show me", not a diagnostic of what could not be inspected.
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
