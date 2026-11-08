import { getWorkspaceProjectIdentity } from '../workspace-trust/index.js';
import { isWorkspacePathContained } from '../workspace-trust/project-reader-path.js';

import type { IFrameworkHost } from '../host/framework-host.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

/**
 * The directory a session works in.
 *
 * The prompt and context start directories are the path from the trusted project's root to this
 * directory. A directory spelled another way than the root (a symlink, or on Windows an 8.3 short
 * name) is accepted by the trust check on its real path, but left as written it gives a path that
 * leaves the root, and every `@path` read would be refused. Such a directory is bound as the host's
 * real path of it, in the spelling the project's identity uses. A directory already inside the root
 * as written keeps its spelling, as does one in a restricted session (no root to relate to), under a
 * host with no canonicalizer, or that cannot be resolved: the entry points that bind a trusted
 * decision refuse a directory they cannot place.
 */
export function resolveSessionWorkspaceCwd(
  cwd: string,
  projectAccess: TWorkspaceProjectAccess,
  host: Pick<IFrameworkHost, 'canonicalizePath'>,
): string {
  if (cwd === '' || projectAccess.status !== 'trusted' || host.canonicalizePath === undefined) {
    return cwd;
  }
  const root = getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot;
  if (isWorkspacePathContained(root, cwd)) return cwd;
  try {
    return host.canonicalizePath(cwd);
  } catch {
    // allow-fallback: the directory cannot be resolved, so it keeps the spelling it was given.
    return cwd;
  }
}
