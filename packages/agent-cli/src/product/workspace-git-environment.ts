import { productSecureMode } from './session-sealing.js';

import type { ICliRuntimeContext } from './runtime-context.js';

/** A secure trust probe inherits only the host values needed to find and run Git. */
export function workspaceGitEnvironment(runtime: ICliRuntimeContext): NodeJS.ProcessEnv | undefined {
  if (!productSecureMode(runtime)) return undefined;
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP']) {
    const value = runtime.environment[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
