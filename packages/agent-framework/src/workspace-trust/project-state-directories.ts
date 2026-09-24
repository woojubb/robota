import { join, sep } from 'node:path';

import { workspacePathSegments } from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { TWorkspaceProjectStateDirectories, TWorkspaceProjectStateNamespace } from './types.js';

const namespaces: readonly TWorkspaceProjectStateNamespace[] = [
  'sessions',
  'session-logs',
  'memory',
  'checkpoints',
];

export function snapshotProjectStateDirectories(
  candidate: TWorkspaceProjectStateDirectories | undefined,
): TWorkspaceProjectStateDirectories | undefined {
  if (candidate === undefined) return undefined;
  const roots = {} as Record<TWorkspaceProjectStateNamespace, string>;
  for (const namespace of namespaces) {
    const root = candidate[namespace];
    if (typeof root !== 'string') {
      throw new WorkspaceAuthorityRequiredError(`A project state directory is required for ${namespace}.`);
    }
    roots[namespace] = join(...workspacePathSegments(root));
  }
  for (const [index, leftNamespace] of namespaces.entries()) {
    const left = roots[leftNamespace];
    for (const rightNamespace of namespaces.slice(index + 1)) {
      const right = roots[rightNamespace];
      if (left === right || left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`)) {
        throw new WorkspaceAuthorityRequiredError('Project state directories must not overlap.');
      }
    }
  }
  return Object.freeze(roots);
}
