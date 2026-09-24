import { isAbsolute, join, sep } from 'node:path';

import { AGENTS_FILENAME, CLAUDE_FILENAME } from '../context/context-loader.js';
import { PROJECT_DETECTOR_PATHS } from '../context/project-detector.js';

import type { ISkillRootDescriptor } from '../commands/skill-source.js';

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

/** Framework candidate paths plus the host-selected skill roots used by its loader. */
export function listFrameworkProjectContributionPaths(
  cwdRelative: string,
  skillRoots: readonly ISkillRootDescriptor[] = [],
  taskContext?: { readonly enabled?: boolean; readonly dir?: string },
): readonly IProjectContributionPath[] {
  return [
    ...Object.values(PROJECT_DETECTOR_PATHS).map((relativePath) => ({
      id: `project-detection:${relativePath}`,
      label: 'Project detection metadata',
      relativePath,
      expectedKind: 'file' as const,
    })),
    ...skillRoots.map(({ root, kind }) => ({
      id: `skill:${root}`,
      label: kind === 'commands' ? 'Project commands' : 'Project skills',
      relativePath: root,
      expectedKind: 'directory' as const,
    })),
    ...instructionPaths(cwdRelative),
    ...(taskContext?.enabled === false || taskContext?.dir === undefined
      ? []
      : [
          {
            id: `tasks:${taskContext.dir}`,
            label: 'Active task context',
            relativePath: taskContext.dir,
            expectedKind: 'directory' as const,
          },
        ]),
  ];
}
