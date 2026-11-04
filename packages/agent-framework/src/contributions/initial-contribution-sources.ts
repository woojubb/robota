import { createWorkspaceProjectContributionSource } from './contribution-source.js';
import {
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from '../workspace-trust/index.js';

import type { IContributionSource } from './contribution-source.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

/**
 * Compose the initial contribution sources from one explicit trusted-or-restricted decision: the
 * project's source when trusted, then the host-owned `userSources` the caller built. A Node host
 * builds those with `createDefaultUserContributionSources` from `@robota-sdk/agent-framework/node`.
 */
export function createContributionSourcesForProjectAccess(
  projectAccess: TWorkspaceProjectAccess,
  userSources: readonly IContributionSource[],
): readonly IContributionSource[] {
  const projectSources =
    projectAccess.status === 'trusted'
      ? [
          createWorkspaceProjectContributionSource(
            getWorkspaceProjectReader(projectAccess.authority),
            getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot,
          ),
        ]
      : [];
  return [...projectSources, ...userSources];
}
