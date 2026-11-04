/**
 * The pieces `Session` takes by injection, as the host lends them.
 *
 * `@robota-sdk/agent-session` is platform-neutral: it never reads the home directory, follows a
 * symlink or resolves a path against a workspace itself. A host that lends none of the three gets the
 * session's own meaning of "absent" (agent-session's README table), so nothing here substitutes a
 * default: a member the host leaves out stays out of the options.
 */

import type { IFrameworkHost } from '../host/framework-host.js';
import type { ISessionOptions } from '@robota-sdk/agent-session';

/** The home directory, workspace resolver and path canonicalizer `host` lends a session rooted at `cwd`. */
export function hostSessionPorts(
  host: IFrameworkHost,
  cwd: string,
): Pick<ISessionOptions, 'homeDirectory' | 'resolveInWorkspace' | 'canonicalizePath'> {
  return {
    ...(host.homeDirectory !== undefined ? { homeDirectory: host.homeDirectory } : {}),
    ...(host.createWorkspacePathResolver !== undefined
      ? { resolveInWorkspace: host.createWorkspacePathResolver(cwd) }
      : {}),
    ...(host.canonicalizePath !== undefined ? { canonicalizePath: host.canonicalizePath } : {}),
  };
}
