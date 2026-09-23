import { createNodeWorkspaceIdentityResolver } from './node-host-workspace-trust.js';
import { inspectProjectKindFromHandle } from './project-reader-handle.js';
import { workspacePathSegments } from './project-reader-path.js';

import type { IWorkspaceIdentity, TWorkspaceContributionKind } from './types.js';

export type TPreTrustProjectPathKind = TWorkspaceContributionKind | 'absent' | 'unavailable';

export interface IPreTrustProjectPathInspection {
  readonly relativePath: string;
  readonly kind: TPreTrustProjectPathKind;
}

/**
 * Inspect only metadata for owner-declared project paths before trust is granted. The same
 * identity-revalidating, no-follow path walk used by trusted readers is called without exposing
 * their content-reading authority. A replaced root or unsafe ancestor yields no metadata claim.
 */
export function inspectPreTrustProjectPaths(
  identity: IWorkspaceIdentity,
  relativePaths: readonly string[],
): readonly IPreTrustProjectPathInspection[] {
  // Portable path inspection cannot pin ancestors during a metadata lookup. Keep the
  // candidate names visible, but make no metadata claim without Linux's handle walk.
  if (process.platform !== 'linux') {
    return relativePaths.map((relativePath) => ({ relativePath, kind: 'unavailable' }));
  }
  const identityResolver = createNodeWorkspaceIdentityResolver();
  return relativePaths.map((relativePath) => {
    try {
      const segments = workspacePathSegments(relativePath);
      const kind = inspectProjectKindFromHandle(identity, identityResolver, segments);
      return { relativePath, kind: kind ?? 'absent' };
    } catch {
      // A symlinked ancestor, changed identity, or inaccessible path cannot be described safely.
      return { relativePath, kind: 'unavailable' };
    }
  });
}
