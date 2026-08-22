import { homedir } from 'node:os';

import { createWorkspaceProjectContributionSource } from './contribution-source.js';
import { createNodeHostContributionSource } from './node-host-contribution-source.js';
import { getWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { IContributionSource } from './contribution-source.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

/** Default host-owned contribution roots. Project content is intentionally absent. */
export function createDefaultUserContributionSources(
  userHome: string = homedir(),
): readonly IContributionSource[] {
  return [createNodeHostContributionSource(userHome)];
}

/** Compose the initial contribution sources from one explicit trusted-or-restricted decision. */
export function createContributionSourcesForProjectAccess(
  projectAccess: TWorkspaceProjectAccess,
  userHome: string = homedir(),
): readonly IContributionSource[] {
  const projectSources =
    projectAccess.status === 'trusted'
      ? [
          createWorkspaceProjectContributionSource(
            getWorkspaceProjectReader(projectAccess.authority),
          ),
        ]
      : [];
  return [...projectSources, ...createDefaultUserContributionSources(userHome)];
}
