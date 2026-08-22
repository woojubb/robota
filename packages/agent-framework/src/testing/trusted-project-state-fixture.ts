import { realpathSync } from 'node:fs';

import {
  WorkspaceTrustService,
  getWorkspaceProjectStateStorage,
} from '../workspace-trust/index.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  IWorkspaceProjectStateStorage,
  TWorkspaceProjectStateNamespace,
} from '../workspace-trust/index.js';

class TrustedFixtureStore implements IWorkspaceTrustStore {
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

/** Test-only helper that still exercises the production service mint path. */
export async function createTrustedProjectStateFixture(
  root: string,
  namespace: TWorkspaceProjectStateNamespace,
): Promise<IWorkspaceProjectStateStorage> {
  const canonicalRoot = realpathSync(root);
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${canonicalRoot}`,
    displayPath: canonicalRoot,
    worktreeRoot: canonicalRoot,
  };
  const service = new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: new TrustedFixtureStore(),
  });
  const access = await service.inspect(canonicalRoot);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return getWorkspaceProjectStateStorage(access.authority, namespace);
}
