/**
 * The host pieces `Session` takes by injection, as this Node-only package supplies them.
 *
 * `@robota-sdk/agent-session` is platform-neutral: it never reads the home directory, follows a
 * symlink or watches the process for exit itself. A package that composes a session for a Node host
 * passes these, so the permission gate and the recovery checks behave as they always did.
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';

import { createNodeWorkspacePathResolver } from '@robota-sdk/agent-session/node';

import type { ISessionOptions } from '@robota-sdk/agent-session';

/** The home directory, workspace resolver and canonicalizer of the Node host the session runs on. */
export function nodeSessionPorts(
  cwd: string,
): Required<Pick<ISessionOptions, 'homeDirectory' | 'resolveInWorkspace' | 'canonicalizePath'>> {
  return {
    homeDirectory: homedir(),
    resolveInWorkspace: createNodeWorkspacePathResolver(cwd),
    // Throws on a missing directory, as the session's own checks always did.
    canonicalizePath: (path) => realpathSync(path),
  };
}
