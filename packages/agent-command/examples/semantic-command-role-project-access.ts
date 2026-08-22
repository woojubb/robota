import { realpathSync } from 'node:fs';

import { WorkspaceTrustService } from '@robota-sdk/agent-framework';

import type {
  IResolvedConfig,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceTrustStoreSnapshot,
} from '@robota-sdk/agent-framework';

export const config: IResolvedConfig = {
  defaultTrustLevel: 'moderate',
  provider: { name: 'scripted-test-provider', apiKey: 'offline', model: 'scripted' },
  permissions: { allow: [], deny: [] },
  language: 'en',
  env: {},
};

export const terminal = {
  write: () => {},
  writeLine: () => {},
  spinner: () => ({ stop: () => {} }),
};

/** Scenario-only host composition that still drives the production authority mint boundary. */
export async function createScenarioProjectAccess(
  root: string,
): Promise<ITrustedWorkspaceProjectAccess> {
  const canonicalRoot = realpathSync(root);
  const identity: IWorkspaceIdentity = {
    repositoryKey: `semantic-role-scenario:${canonicalRoot}`,
    displayPath: canonicalRoot,
    worktreeRoot: canonicalRoot,
  };
  const trusted: IWorkspaceTrustStoreSnapshot = {
    state: 'trusted',
    generation: 1,
    grantedAt: '2026-08-22T00:00:00.000Z',
  };
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => trusted,
      grant: async () => trusted,
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  }).inspect(canonicalRoot);
  if (access.status !== 'trusted') throw new Error('Scenario workspace grant was not trusted.');
  return access;
}
