import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectIdentity,
} from '../workspace-trust/index.js';
import { isWorkspacePathContained } from '../workspace-trust/project-reader-path.js';

import type { IFrameworkHost } from '../host/framework-host.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

/**
 * A trusted project covers the directory a runtime or a query is built on.
 *
 * Contained — ARCH-048. These boundaries reject cross-root pairs until one canonical project-root
 * binding contract replaces the independent cwd and projectAccess carriers. Restricted access has no
 * root to cover, so it passes.
 *
 * The check compares real paths, so it needs the host's `canonicalizePath`: a host that lends none
 * cannot say where `cwd` really is, and a trusted decision is refused rather than taken on the
 * spelling of a path. The identity is read first, so an access that is not a minted decision is
 * refused for that reason whatever the host lends.
 */
export function assertTrustedProjectCoversCwd(
  host: IFrameworkHost,
  projectAccess: TWorkspaceProjectAccess,
  cwd: string,
): void {
  if (projectAccess.status !== 'trusted') return;
  const trustedRoot = getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot;
  const canonicalizePath = host.canonicalizePath;
  if (canonicalizePath === undefined) {
    throw new WorkspaceAuthorityRequiredError(
      'Trusted project access needs a host that resolves real paths (`host.canonicalizePath`); this host lends none.',
    );
  }
  let resolvedCwd: string;
  try {
    resolvedCwd = canonicalizePath(cwd);
  } catch {
    throw new WorkspaceAuthorityRequiredError(
      'Trusted project access cannot validate the requested working directory.',
    );
  }
  if (!isWorkspacePathContained(trustedRoot, resolvedCwd)) {
    throw new WorkspaceAuthorityRequiredError(
      'Trusted project access does not cover the requested working directory.',
    );
  }
}
