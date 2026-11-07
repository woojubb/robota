import { createTestProductRuntime } from './product-runtime.js';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
import { productProjectStateDirectories } from '../../product/project-state-directories.js';

import { createNodeWorkspaceProjectFiles } from '@robota-sdk/agent-framework/node';
import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceTrustStoreSnapshot,
} from '@robota-sdk/agent-framework';
const PRODUCT_PROJECT_STATE_DIRECTORIES = productProjectStateDirectories(createTestProductRuntime());


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
    projectFiles: createNodeWorkspaceProjectFiles(),
    identityResolver: { resolve: () => identity },
    projectStateDirectories: PRODUCT_PROJECT_STATE_DIRECTORIES,
    store: {
      inspect: async () => trusted,
      grant: async () => trusted,
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  }).inspect(worktreeRoot);
  if (access.status !== 'trusted') throw new Error('Expected trusted project access fixture.');
  return access;
}
