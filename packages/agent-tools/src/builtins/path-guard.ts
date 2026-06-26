import { resolve, sep } from 'node:path';

import type { IToolInvocationResult } from '../types/tool-result.js';

/**
 * Returns a JSON-serialized IToolInvocationResult error when filePath is outside cwd.
 * Returns undefined when the path is within cwd or cwd is not set.
 */
export function checkPathWithinCwd(filePath: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined;

  const resolved = resolve(filePath);
  const cwdResolved = resolve(cwd);

  if (resolved !== cwdResolved && !resolved.startsWith(cwdResolved + sep)) {
    const result: IToolInvocationResult = {
      success: false,
      output: '',
      error: `Access denied: "${filePath}" is outside the working directory`,
    };
    return JSON.stringify(result);
  }

  return undefined;
}
