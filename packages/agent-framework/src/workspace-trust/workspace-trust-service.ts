import {
  getWorkspaceProjectIdentity,
  mintWorkspaceProjectAuthority,
} from './workspace-authority.js';
import { snapshotProjectFiles } from './project-files.js';
import { snapshotProjectStateDirectories } from './project-state-directories.js';

import type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectFiles,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceProjectStateDirectories,
  TWorkspaceProjectAccess,
} from './types.js';

export interface IWorkspaceTrustServiceOptions {
  readonly identityResolver: IWorkspaceIdentityResolver;
  readonly store: IWorkspaceTrustStore;
  /**
   * The host operations that read and write project files under a trusted root, bound to every
   * authority this service mints. Required: a service that could issue an authority without them
   * would issue one that can touch nothing. A Node host passes `createNodeWorkspaceProjectFiles()`
   * from `@robota-sdk/agent-framework/node`; a host that has no such operations builds no service,
   * and `createRestrictedWorkspaceProjectAccess` gives its sessions their Restricted access.
   */
  readonly projectFiles: IWorkspaceProjectFiles;
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
  // Every field and helper is `#` private: the service is the one thing that can mint an authority, and
  // the host's file operations it holds take any root, so no property of it, and no method a caller
  // could reach, may expose them, the generations that decide liveness or the minting step.
  readonly #issuerGenerations = new Map<string, number>();
  readonly #identityResolver: IWorkspaceIdentityResolver;
  readonly #store: IWorkspaceTrustStore;
  readonly #projectStateDirectories: TWorkspaceProjectStateDirectories | undefined;
  readonly #projectFiles: IWorkspaceProjectFiles;

  constructor(options: IWorkspaceTrustServiceOptions) {
    this.#projectFiles = snapshotProjectFiles(options.projectFiles);
    this.#projectStateDirectories = snapshotProjectStateDirectories(
      options.projectStateDirectories,
    );
    this.#identityResolver = options.identityResolver;
    this.#store = options.store;
  }

  #identityKey(identity: IWorkspaceIdentity): string {
    return `${identity.repositoryKey}\0${identity.worktreeRoot}`;
  }

  #recordGeneration(identity: IWorkspaceIdentity, generation: number): boolean {
    const identityKey = this.#identityKey(identity);
    const currentGeneration = this.#issuerGenerations.get(identityKey);
    if (currentGeneration !== undefined && generation < currentGeneration) return false;
    this.#issuerGenerations.set(identityKey, generation);
    return true;
  }

  async inspect(cwd: string): Promise<TWorkspaceProjectAccess> {
    let identity: IWorkspaceIdentity;
    try {
      identity = this.#identityResolver.resolve(cwd);
    } catch (error) {
      // keep the swallowed error's name and message so a doctor can name the cause.
      return createRestrictedWorkspaceProjectAccess(
        'identity-unavailable',
        undefined,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    let snapshot;
    try {
      snapshot = await this.#store.inspect(identity);
    } catch (error) {
      return createRestrictedWorkspaceProjectAccess(
        'store-unavailable',
        identity.displayPath,
        error instanceof Error ? error : new Error(String(error)),
        identity,
      );
    }
    if (!this.#recordGeneration(identity, snapshot.generation)) {
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

    return this.#mintTrustedAccess(identity, snapshot);
  }

  /** The trusted branch: re-resolve the identity so a moved or replaced worktree cannot keep authority. */
  #mintTrustedAccess(
    identity: IWorkspaceIdentity,
    snapshot: IWorkspaceTrustStoreSnapshot,
  ): TWorkspaceProjectAccess {
    let currentIdentity: IWorkspaceIdentity;
    try {
      currentIdentity = this.#identityResolver.resolve(identity.worktreeRoot);
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

    const identityKey = this.#identityKey(currentIdentity);
    const authority = mintWorkspaceProjectAuthority(
      currentIdentity,
      this.#identityResolver,
      () => this.#issuerGenerations.get(identityKey) === snapshot.generation,
      this.#projectFiles,
      this.#projectStateDirectories,
    );
    return {
      status: 'trusted',
      authority,
      identity: getWorkspaceProjectIdentity(authority),
      ...(snapshot.grantedAt === undefined ? {} : { grantedAt: snapshot.grantedAt }),
    };
  }

  async grant(cwd: string): Promise<TWorkspaceProjectAccess> {
    const identity = this.#identityResolver.resolve(cwd);
    const snapshot = await this.#store.inspect(identity);
    const granted = await this.#store.grant(identity, snapshot.generation);
    this.#recordGeneration(identity, granted.generation);
    return this.inspect(cwd);
  }

  async revoke(cwd: string): Promise<TWorkspaceProjectAccess> {
    const identity = this.#identityResolver.resolve(cwd);
    const snapshot = await this.#store.inspect(identity);
    const revoked = await this.#store.revoke(identity, snapshot.generation);
    this.#recordGeneration(identity, revoked.generation);
    return this.inspect(cwd);
  }
}
