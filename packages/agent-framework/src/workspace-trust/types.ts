declare const workspaceProjectAuthorityType: unique symbol;
declare const workspaceProjectReaderType: unique symbol;
declare const workspaceProjectStateStorageType: unique symbol;
declare const workspaceProjectSettingsWriterType: unique symbol;

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
  readonly [workspaceProjectReaderType]: true;
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

export type TWorkspaceProjectStateNamespace =
  'sessions' | 'session-logs' | 'memory' | 'checkpoints';

export interface IWorkspaceProjectStateStorage {
  readonly [workspaceProjectStateStorageType]: true;
  readonly namespace: TWorkspaceProjectStateNamespace;
  readText(relativePath: string, purpose: string): string | undefined;
  readBytes(relativePath: string, purpose: string): Uint8Array | undefined;
  writeText(relativePath: string, content: string, purpose: string): void;
  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void;
  appendText(relativePath: string, content: string, purpose: string): void;
  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[];
  deleteFile(relativePath: string, purpose: string): boolean;
  projectRelativePath(relativePath: string): string;
}

export type TWorkspaceProjectSettingsTarget = 'project' | 'project-local';

export type TWorkspaceProjectSettingsWriteDecision =
  | {
      readonly status: 'approved';
      readonly target: TWorkspaceProjectSettingsTarget;
      readonly purpose: string;
    }
  | { readonly status: 'denied'; readonly reason: string };

export interface IWorkspaceProjectSettingsWriter {
  readonly [workspaceProjectSettingsWriterType]: true;
  readonly target: TWorkspaceProjectSettingsTarget;
  writeText(content: string): void;
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
