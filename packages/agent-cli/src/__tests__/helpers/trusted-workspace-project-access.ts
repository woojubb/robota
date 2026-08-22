import { WorkspaceTrustService } from '@robota-sdk/agent-framework';

import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceTrustStoreSnapshot,
} from '@robota-sdk/agent-framework';

export async function createTrustedWorkspaceProjectAccess(
  worktreeRoot: string,
): Promise<ITrustedWorkspaceProjectAccess> {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `test:${worktreeRoot}`,
    displayPath: worktreeRoot,
    worktreeRoot,
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
  }).inspect(worktreeRoot);
  if (access.status !== 'trusted') throw new Error('Expected trusted project access fixture.');
  return access;
}
