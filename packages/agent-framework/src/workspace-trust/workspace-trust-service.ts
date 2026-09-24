import {
  getWorkspaceProjectIdentity,
  mintWorkspaceProjectAuthority,
} from './workspace-authority.js';
import { snapshotProjectStateDirectories } from './project-state-directories.js';

import type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceProjectStateDirectories,
  TWorkspaceProjectAccess,
} from './types.js';

export interface IWorkspaceTrustServiceOptions {
  readonly identityResolver: IWorkspaceIdentityResolver;
  readonly store: IWorkspaceTrustStore;
  readonly projectStateDirectories?: TWorkspaceProjectStateDirectories;
}

export function createRestrictedWorkspaceProjectAccess(
  trustState: IRestrictedWorkspaceProjectAccess['trustState'],
  displayPath?: string,
  cause?: Error,
  identity?: IWorkspaceIdentity,
): IRestrictedWorkspaceProjectAccess {
  return {
    status: 'restricted',
    reason: 'WorkspaceAuthorityRequired',
    trustState,
    ...(displayPath === undefined ? {} : { displayPath }),
    ...(identity === undefined ? {} : { identity }),
    ...(cause === undefined ? {} : { cause: { name: cause.name, message: cause.message } }),
  };
}

function sameIdentity(left: IWorkspaceIdentity, right: IWorkspaceIdentity): boolean {
  return left.repositoryKey === right.repositoryKey && left.worktreeRoot === right.worktreeRoot;
}

export class WorkspaceTrustService {
  private readonly issuerGenerations = new Map<string, number>();
  private readonly projectStateDirectories: TWorkspaceProjectStateDirectories | undefined;

  constructor(private readonly options: IWorkspaceTrustServiceOptions) {
    this.projectStateDirectories = snapshotProjectStateDirectories(options.projectStateDirectories);
  }

  private identityKey(identity: IWorkspaceIdentity): string {
    return `${identity.repositoryKey}\0${identity.worktreeRoot}`;
  }

  private recordGeneration(identity: IWorkspaceIdentity, generation: number): boolean {
    const identityKey = this.identityKey(identity);
    const currentGeneration = this.issuerGenerations.get(identityKey);
    if (currentGeneration !== undefined && generation < currentGeneration) return false;
    this.issuerGenerations.set(identityKey, generation);
    return true;
  }

  async inspect(cwd: string): Promise<TWorkspaceProjectAccess> {
    let identity: IWorkspaceIdentity;
    try {
      identity = this.options.identityResolver.resolve(cwd);
    } catch (error) {
      // OBSERVABILITY-1991: keep the swallowed error's name and message so a doctor can name the cause.
      return createRestrictedWorkspaceProjectAccess(
        'identity-unavailable',
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    let snapshot;
    try {
      snapshot = await this.options.store.inspect(identity);
    } catch (error) {
      return createRestrictedWorkspaceProjectAccess(
        'store-unavailable',
        identity.displayPath,
        error instanceof Error ? error : new Error(String(error)),
        identity,
      );
    }
    if (!this.recordGeneration(identity, snapshot.generation)) {
      return createRestrictedWorkspaceProjectAccess(
        'stale/replaced',
        identity.displayPath,
        undefined,
        identity,
      );
    }
    if (snapshot.state !== 'trusted') {
      return createRestrictedWorkspaceProjectAccess(
        snapshot.state,
        identity.displayPath,
        undefined,
        identity,
      );
    }

    return this.mintTrustedAccess(identity, snapshot);
  }

  /** The trusted branch: re-resolve the identity so a moved or replaced worktree cannot keep authority. */
  private mintTrustedAccess(
    identity: IWorkspaceIdentity,
    snapshot: IWorkspaceTrustStoreSnapshot,
  ): TWorkspaceProjectAccess {
    let currentIdentity: IWorkspaceIdentity;
    try {
      currentIdentity = this.options.identityResolver.resolve(identity.worktreeRoot);
    } catch (error) {
      return createRestrictedWorkspaceProjectAccess(
        'identity-unavailable',
        identity.displayPath,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    if (!sameIdentity(identity, currentIdentity)) {
      return createRestrictedWorkspaceProjectAccess(
        'stale/replaced',
        currentIdentity.displayPath,
        undefined,
        currentIdentity,
      );
    }

    const identityKey = this.identityKey(currentIdentity);
    const authority = mintWorkspaceProjectAuthority(
      currentIdentity,
      this.options.identityResolver,
      () => this.issuerGenerations.get(identityKey) === snapshot.generation,
      this.projectStateDirectories,
    );
    return {
      status: 'trusted',
      authority,
      identity: getWorkspaceProjectIdentity(authority),
      ...(snapshot.grantedAt === undefined ? {} : { grantedAt: snapshot.grantedAt }),
    };
  }

  async grant(cwd: string): Promise<TWorkspaceProjectAccess> {
    const identity = this.options.identityResolver.resolve(cwd);
    const snapshot = await this.options.store.inspect(identity);
    const granted = await this.options.store.grant(identity, snapshot.generation);
    this.recordGeneration(identity, granted.generation);
    return this.inspect(cwd);
  }

  async revoke(cwd: string): Promise<TWorkspaceProjectAccess> {
    const identity = this.options.identityResolver.resolve(cwd);
    const snapshot = await this.options.store.inspect(identity);
    const revoked = await this.options.store.revoke(identity, snapshot.generation);
    this.recordGeneration(identity, revoked.generation);
    return this.inspect(cwd);
  }
}
