import { realpathSync } from 'node:fs';

import { WorkspaceTrustService } from '@robota-sdk/agent-framework';

import type {
  IWorkspaceIdentity,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

class ScenarioTrustStore implements IWorkspaceTrustStore {
  inspect(): Promise<IWorkspaceTrustStoreSnapshot> {
    return Promise.resolve({ state: 'trusted', generation: 1 });
  }

  grant(): Promise<IWorkspaceTrustStoreSnapshot> {
    return this.inspect();
  }

  revoke(): Promise<IWorkspaceTrustStoreSnapshot> {
    return Promise.resolve({ state: 'revoked', generation: 2 });
  }
}

/** Mint scenario project access through the production host authority boundary. */
export function createSessionEventRenderingProjectAccess(
  cwd: string,
): Promise<TWorkspaceProjectAccess> {
  const canonicalRoot = realpathSync(cwd);
  const identity: IWorkspaceIdentity = {
    repositoryKey: `session-event-rendering:${canonicalRoot}`,
    displayPath: canonicalRoot,
    worktreeRoot: canonicalRoot,
  };
  return new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: new ScenarioTrustStore(),
  }).inspect(canonicalRoot);
}
