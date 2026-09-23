import { isAbsolute, join, sep } from 'node:path';

import { SKILL_ROOTS } from '../commands/skill-source.js';
import { AGENTS_FILENAME, CLAUDE_FILENAME } from '../context/context-loader.js';
import { PROJECT_DETECTOR_PATHS } from '../context/project-detector.js';
import { TASKS_DIR } from '../context/task-context.js';
import { NAMESPACE_DIRECTORIES } from '../workspace-trust/project-state-storage.js';

/** Metadata-only project paths that may become available after workspace trust is granted. */
export interface IProjectContributionPath {
  readonly id: string;
  readonly label: string;
  readonly relativePath: string;
  readonly expectedKind: 'file' | 'directory';
}

function ancestorDirectories(cwdRelative: string): readonly string[] {
  if (isAbsolute(cwdRelative)) throw new Error('Project inventory requires a relative cwd.');
  if (cwdRelative === '') return [''];
  const segments = cwdRelative.split(sep);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Project inventory cwd must stay inside the project root.');
  }
  return ['', ...segments.map((_, index) => join(...segments.slice(0, index + 1)))];
}

function instructionPaths(cwdRelative: string): readonly IProjectContributionPath[] {
  return ancestorDirectories(cwdRelative).flatMap((directory) => [
    {
      id: `instructions:${directory}:${AGENTS_FILENAME}`,
      label: 'Agent instructions',
      relativePath: join(directory, AGENTS_FILENAME),
      expectedKind: 'file' as const,
    },
    {
      id: `instructions:${directory}:${CLAUDE_FILENAME}`,
      label: 'Project notes',
      relativePath: join(directory, CLAUDE_FILENAME),
      expectedKind: 'file' as const,
    },
  ]);
}

/** Every fixed framework-owned source, derived from the paths its loader or store uses. */
export function listFrameworkProjectContributionPaths(
  cwdRelative: string,
): readonly IProjectContributionPath[] {
  return [
    ...Object.values(PROJECT_DETECTOR_PATHS).map((relativePath) => ({
      id: `project-detection:${relativePath}`,
      label: 'Project detection metadata',
      relativePath,
      expectedKind: 'file' as const,
    })),
    ...SKILL_ROOTS.map(({ root, kind }) => ({
      id: `skill:${root}`,
      label: kind === 'commands' ? 'Project commands' : 'Project skills',
      relativePath: root,
      expectedKind: 'directory' as const,
    })),
    ...instructionPaths(cwdRelative),
    {
      id: `tasks:${TASKS_DIR}`,
      label: 'Active task context',
      relativePath: TASKS_DIR,
      expectedKind: 'directory',
    },
    ...Object.entries(NAMESPACE_DIRECTORIES).map(([namespace, relativePath]) => ({
      id: `state:${namespace}`,
      label: `Project ${namespace}`,
      relativePath,
      expectedKind: 'directory' as const,
    })),
  ];
}
