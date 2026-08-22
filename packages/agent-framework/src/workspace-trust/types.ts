declare const workspaceProjectAuthorityType: unique symbol;

/**
 * Opaque proof that the host granted project access for the currently resolved workspace identity.
 * Runtime acceptance is stricter than this type: only an exact service-minted object is accepted.
 */
export interface IWorkspaceProjectAuthority {
  readonly [workspaceProjectAuthorityType]: true;
}

export type TWorkspaceProjectAuthorityCandidate =
  object | string | number | boolean | bigint | symbol | null | undefined;

export type TWorkspaceTrustState =
  | 'trusted'
  | 'untrusted'
  | 'revoked'
  | 'stale/replaced'
  | 'identity-unavailable'
  | 'store-unavailable';

export interface IWorkspaceIdentity {
  readonly repositoryKey: string;
  readonly displayPath: string;
  readonly worktreeRoot: string;
}

export interface IWorkspaceIdentityResolver {
  resolve(cwd: string): IWorkspaceIdentity;
}

export interface IWorkspaceTrustStoreSnapshot {
  readonly state: 'trusted' | 'untrusted' | 'revoked' | 'stale/replaced';
  readonly generation: number;
  readonly grantedAt?: string;
}

export interface IWorkspaceTrustStore {
  inspect(identity: IWorkspaceIdentity): Promise<IWorkspaceTrustStoreSnapshot>;
  grant(
    identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot>;
  revoke(
    identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot>;
}

export type TWorkspaceContributionKind = 'file' | 'directory' | 'link' | 'other';

export interface IWorkspaceDirectoryEntry {
  readonly name: string;
  readonly kind: TWorkspaceContributionKind;
}

export interface IWorkspaceAncestorTextEntry {
  readonly relativePath: string;
  readonly content: string;
}

/** A root-relative, link-refusing read facet derived from a project authority. */
export interface IWorkspaceProjectReader {
  readText(relativePath: string, purpose: string): string | undefined;
  readBytes(relativePath: string, purpose: string): Uint8Array | undefined;
  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[];
  inspectKind(relativePath: string, purpose: string): TWorkspaceContributionKind | undefined;
  readTextAlongAncestors(
    startRelativeDirectory: string,
    filename: string,
    purpose: string,
  ): readonly IWorkspaceAncestorTextEntry[];
}

export interface ITrustedWorkspaceProjectAccess {
  readonly status: 'trusted';
  readonly authority: IWorkspaceProjectAuthority;
  readonly identity: IWorkspaceIdentity;
  readonly grantedAt?: string;
}

export interface IRestrictedWorkspaceProjectAccess {
  readonly status: 'restricted';
  readonly reason: 'WorkspaceAuthorityRequired';
  readonly trustState: Exclude<TWorkspaceTrustState, 'trusted'>;
  readonly displayPath?: string;
}

export type TWorkspaceProjectAccess =
  ITrustedWorkspaceProjectAccess | IRestrictedWorkspaceProjectAccess;
