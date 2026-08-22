import { realpathSync } from 'node:fs';

import {
  createDefaultUserSettingsSources,
  createWorkspaceProjectSettingsSources,
} from '../config/settings-source.js';
import { createProjectSessionStore } from '../interactive/session-persistence.js';
import {
  WorkspaceTrustService,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from '../workspace-trust/index.js';

import type { TSettingsSource } from '../config/settings-source.js';
import type {
  IWorkspaceIdentity,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  IWorkspaceProjectStateStorage,
  TWorkspaceProjectStateNamespace,
  TWorkspaceProjectAccess,
} from '../workspace-trust/index.js';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-transport';

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
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return getWorkspaceProjectStateStorage(access.authority, namespace);
}

/** Test-only access decision produced through the production service mint path. */
export async function createTrustedProjectAccessFixture(
  root: string,
): Promise<TWorkspaceProjectAccess> {
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
  return access;
}

/** Test-only project session adapter assembled from two production-minted state facets. */
export async function createTrustedProjectSessionStoreFixture(
  root: string,
): Promise<IInteractiveSessionStore> {
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return createProjectSessionStore(
    getWorkspaceProjectStateStorage(access.authority, 'sessions'),
    getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
  );
}

/** Test-only settings precedence assembled from explicit user and production-minted project sources. */
export async function createTrustedSettingsSourcesFixture(
  root: string,
): Promise<readonly TSettingsSource[]> {
  const access = await createTrustedProjectAccessFixture(root);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return [
    ...createDefaultUserSettingsSources(),
    ...createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(access.authority)),
  ];
}
