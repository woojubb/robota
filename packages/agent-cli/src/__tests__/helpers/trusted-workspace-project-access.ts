import { createTestProductRuntime } from './product-runtime.js';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
import { productProjectStateDirectories } from '../../product/project-state-directories.js';

import { createNodeWorkspaceProjectFiles } from '@robota-sdk/agent-framework/node';
import type { ICliRuntimeContext } from '../../product/runtime-context.js';
import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceTrustStoreSnapshot,
} from '@robota-sdk/agent-framework';
const PRODUCT_PROJECT_STATE_DIRECTORIES = productProjectStateDirectories(createTestProductRuntime());


/** Trusted access whose state directories are the plain ones, or those of `runtime` (a secure one's differ). */
export async function createTrustedWorkspaceProjectAccess(
  worktreeRoot: string,
  runtime?: ICliRuntimeContext,
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
    projectStateDirectories:
      runtime === undefined
        ? PRODUCT_PROJECT_STATE_DIRECTORIES
        : productProjectStateDirectories(runtime),
    store: {
      inspect: async () => trusted,
      grant: async () => trusted,
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  }).inspect(worktreeRoot);
  if (access.status !== 'trusted') throw new Error('Expected trusted project access fixture.');
  return access;
}
