import { workspacePathSegments } from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { TWorkspaceProjectStateDirectories, TWorkspaceProjectStateNamespace } from './types.js';

const namespaces: readonly TWorkspaceProjectStateNamespace[] = [
  'sessions',
  'session-logs',
  'memory',
  'checkpoints',
];

/**
 * Each directory is kept in the spelling the host validated: the host compares it with the layout
 * it built, and a Windows host's `node:path` writes `.robota\sessions`, which joining the segments
 * back with `/` would no longer match. Overlap is decided on the segments, so it does not depend
 * on the spelling.
 */
export function snapshotProjectStateDirectories(
  candidate: TWorkspaceProjectStateDirectories | undefined,
): TWorkspaceProjectStateDirectories | undefined {
  if (candidate === undefined) return undefined;
  const roots = {} as Record<TWorkspaceProjectStateNamespace, string>;
  const overlapKeys = {} as Record<TWorkspaceProjectStateNamespace, string>;
  for (const namespace of namespaces) {
    const root = candidate[namespace];
    if (typeof root !== 'string') {
      throw new WorkspaceAuthorityRequiredError(`A project state directory is required for ${namespace}.`);
    }
    overlapKeys[namespace] = workspacePathSegments(root).join('/');
    roots[namespace] = root;
  }
  for (const [index, leftNamespace] of namespaces.entries()) {
    const left = overlapKeys[leftNamespace];
    for (const rightNamespace of namespaces.slice(index + 1)) {
      const right = overlapKeys[rightNamespace];
      if (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)) {
        throw new WorkspaceAuthorityRequiredError('Project state directories must not overlap.');
      }
    }
  }
  return Object.freeze(roots);
}
