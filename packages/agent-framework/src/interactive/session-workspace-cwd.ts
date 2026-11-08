import type { IFrameworkHost } from '../host/framework-host.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

/**
 * The directory a session works in.
 *
 * Under a trusted project it is the host's real path of the directory it was given, in the spelling
 * the project's identity uses. The prompt and context start directories are the path from the
 * identity's root to this directory, so a symlink or a Windows 8.3 short name left as written would
 * turn into a path that leaves the root, and every `@path` read would be refused. A restricted
 * session has no root to relate to, a host with no canonicalizer cannot say where the directory
 * really is, and a directory that cannot be resolved keeps its spelling: the entry points that bind a
 * trusted decision refuse such a directory themselves.
 */
export function resolveSessionWorkspaceCwd(
  cwd: string,
  projectAccess: TWorkspaceProjectAccess,
  host: Pick<IFrameworkHost, 'canonicalizePath'>,
): string {
  if (cwd === '' || projectAccess.status !== 'trusted' || host.canonicalizePath === undefined) {
    return cwd;
  }
  try {
    return host.canonicalizePath(cwd);
  } catch {
    // allow-fallback: the directory cannot be resolved, so it keeps the spelling it was given.
    return cwd;
  }
}
