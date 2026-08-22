import { WorkspaceTrustService, createWorkspaceProjectMutation } from '@robota-sdk/agent-framework';

import { createWorkspaceWorkflowProject } from '../workflow-project.js';

import type { IWorkspaceIdentity, IWorkspaceTrustStoreSnapshot } from '@robota-sdk/agent-framework';
import type { IWorkflowProject } from '../workflow-project.js';

export async function createWorkflowProjectFixture(root: string): Promise<IWorkflowProject> {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `workflow-test:${root}`,
    displayPath: root,
    worktreeRoot: root,
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
  }).inspect(root);
  if (access.status !== 'trusted') throw new Error('Expected trusted workflow project fixture.');
  const mutation = createWorkspaceProjectMutation(access.authority, {
    status: 'approved',
    purpose: 'workflow test fixture',
  });
  return createWorkspaceWorkflowProject(access.authority, mutation);
}
