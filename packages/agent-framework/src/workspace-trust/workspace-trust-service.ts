import { mintWorkspaceProjectAuthority } from './workspace-authority.js';

import type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceTrustStore,
  TWorkspaceProjectAccess,
} from './types.js';

export interface IWorkspaceTrustServiceOptions {
  readonly identityResolver: IWorkspaceIdentityResolver;
  readonly store: IWorkspaceTrustStore;
}

export function createRestrictedWorkspaceProjectAccess(
  trustState: IRestrictedWorkspaceProjectAccess['trustState'],
  displayPath?: string,
): IRestrictedWorkspaceProjectAccess {
  return {
    status: 'restricted',
    reason: 'WorkspaceAuthorityRequired',
    trustState,
    ...(displayPath === undefined ? {} : { displayPath }),
  };
}

function sameIdentity(left: IWorkspaceIdentity, right: IWorkspaceIdentity): boolean {
  return left.repositoryKey === right.repositoryKey && left.worktreeRoot === right.worktreeRoot;
}

export class WorkspaceTrustService {
  constructor(private readonly options: IWorkspaceTrustServiceOptions) {}

  async inspect(cwd: string): Promise<TWorkspaceProjectAccess> {
    let identity: IWorkspaceIdentity;
    try {
      identity = this.options.identityResolver.resolve(cwd);
    } catch {
      return createRestrictedWorkspaceProjectAccess('identity-unavailable');
    }

    let snapshot;
    try {
      snapshot = await this.options.store.inspect(identity);
    } catch {
      return createRestrictedWorkspaceProjectAccess('store-unavailable', identity.displayPath);
    }
    if (snapshot.state !== 'trusted') {
      return createRestrictedWorkspaceProjectAccess(snapshot.state, identity.displayPath);
    }

    let currentIdentity: IWorkspaceIdentity;
    try {
      currentIdentity = this.options.identityResolver.resolve(identity.worktreeRoot);
    } catch {
      return createRestrictedWorkspaceProjectAccess('identity-unavailable', identity.displayPath);
    }
    if (!sameIdentity(identity, currentIdentity)) {
      return createRestrictedWorkspaceProjectAccess('stale/replaced', currentIdentity.displayPath);
    }

    return {
      status: 'trusted',
      authority: mintWorkspaceProjectAuthority(currentIdentity, this.options.identityResolver),
      identity: currentIdentity,
      ...(snapshot.grantedAt === undefined ? {} : { grantedAt: snapshot.grantedAt }),
    };
  }

  async grant(cwd: string): Promise<TWorkspaceProjectAccess> {
    const identity = this.options.identityResolver.resolve(cwd);
    const snapshot = await this.options.store.inspect(identity);
    await this.options.store.grant(identity, snapshot.generation);
    return this.inspect(cwd);
  }

  async revoke(cwd: string): Promise<TWorkspaceProjectAccess> {
    const identity = this.options.identityResolver.resolve(cwd);
    const snapshot = await this.options.store.inspect(identity);
    await this.options.store.revoke(identity, snapshot.generation);
    return this.inspect(cwd);
  }
}
