import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import type { IToolInvocationResult } from '../types/tool-result.js';

function isWithinPath(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function findExistingAncestor(path: string): string | undefined {
  let current = path;

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }

  return current;
}

/**
 * Returns a JSON-serialized IToolInvocationResult error when filePath is outside cwd.
 * Returns undefined when the path is within cwd or cwd is not set.
 */
export function checkPathWithinCwd(filePath: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined;

  const resolved = resolve(filePath);
  const cwdResolved = resolve(cwd);

  if (!isWithinPath(resolved, cwdResolved)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Access denied: "${filePath}" is outside the working directory`,
    };
    return JSON.stringify(result);
  }

  const cwdRealPath = tryRealpath(cwdResolved);
  if (cwdRealPath === undefined) return undefined;

  const realpathTarget = existsSync(resolved) ? resolved : findExistingAncestor(resolved);
  const resolvedRealPath = realpathTarget !== undefined ? tryRealpath(realpathTarget) : undefined;

  if (resolvedRealPath !== undefined && !isWithinPath(resolvedRealPath, cwdRealPath)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Access denied: "${filePath}" is outside the working directory`,
    };
    return JSON.stringify(result);
  }

  return undefined;
}
