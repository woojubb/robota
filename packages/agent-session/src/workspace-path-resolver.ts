/**
 * Where a path a shell command names really is, for the gate's read-only command check (issue
 * #3082). Symlinks are followed, as `Read`'s own containment check does: a link committed inside
 * the workspace can point anywhere, so a string check alone cannot say a command stays inside.
 */

import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { TResolveInWorkspace } from '@robota-sdk/agent-core';

/** The real path of `path`, or of its nearest existing ancestor with the rest appended. */
function realOrNearest(path: string): string {
  let existing = path;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(existing);
      return rest.length === 0 ? real : resolve(real, ...rest.reverse());
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return path;
      rest.push(existing.slice(parent.length).replace(/^[\\/]/, ''));
      existing = parent;
    }
  }
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot));
}

export function createWorkspacePathResolver(cwd: string): TResolveInWorkspace {
  return (base, path) => {
    const root = realOrNearest(cwd);
    const real = realOrNearest(resolve(base ?? root, path));
    return isInside(root, real) ? real : undefined;
  };
}
