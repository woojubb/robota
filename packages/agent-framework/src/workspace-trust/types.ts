declare const workspaceProjectAuthorityType: unique symbol;
declare const workspaceProjectReaderType: unique symbol;
declare const workspaceProjectStateStorageType: unique symbol;
declare const workspaceProjectSettingsWriterType: unique symbol;
declare const workspaceProjectMutationType: unique symbol;

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

/**
 * One recorded grant, as the store persists it. FLOW-2006 reads these to resolve a deep link's
 * `repo=owner/name` against clones the user has ALREADY trusted; nothing else enumerates them.
 */
export interface IWorkspaceTrustGrant {
  readonly repositoryKey: string;
  readonly worktreeRoot: string;
  readonly state: 'trusted' | 'revoked';
  readonly generation: number;
  readonly grantedAt?: string;
}

export interface IWorkspaceTrustStore {
  inspect(identity: IWorkspaceIdentity): Promise<IWorkspaceTrustStoreSnapshot>;
  /**
   * Every recorded grant, read-only — OPTIONAL, and optional on purpose.
   *
   * This is a deliberate widening: it hands its caller the list of every local path the user has
   * ever trusted, so it exists for one consumer (FLOW-2006's `repo=owner/name` resolution) and
   * returns the same validated shape the store already enforces. A corrupt store throws rather than
   * returning a partial list — "could not read" is never "no grants".
   *
   * It is optional rather than required because a store is free not to be enumerable: an in-memory
   * test double or a host that keeps grants somewhere unlistable owes no such answer, and forcing
   * one would mean every implementer inventing a list it does not have. The consumer treats absence
   * the same way it treats a read failure — a refusal, never an empty list.
   */
  listGrants?(): Promise<readonly IWorkspaceTrustGrant[]>;
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
  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined;
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
  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined;
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

export type TWorkspaceProjectMutationDecision =
  | { readonly status: 'approved'; readonly purpose: string }
  | { readonly status: 'denied'; readonly reason: string };

/** Root-bounded mutation authority minted separately from trusted project reads. */
export interface IWorkspaceProjectMutation {
  readonly [workspaceProjectMutationType]: true;
  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void;
  deleteFile(relativePath: string, purpose: string): boolean;
}

export interface ITrustedWorkspaceProjectAccess {
  readonly status: 'trusted';
  readonly authority: IWorkspaceProjectAuthority;
  readonly identity: IWorkspaceIdentity;
  readonly grantedAt?: string;
}

/**
 * The owner error behind an `identity-unavailable` or `store-unavailable` trust state
 * (OBSERVABILITY-1991). Name and message only — never file content.
 */
export interface IWorkspaceTrustCause {
  readonly name: string;
  readonly message: string;
}

export interface IRestrictedWorkspaceProjectAccess {
  readonly status: 'restricted';
  readonly reason: 'WorkspaceAuthorityRequired';
  readonly trustState: Exclude<TWorkspaceTrustState, 'trusted'>;
  readonly displayPath?: string;
  /**
   * SCREEN-1993: the identity the trust service resolved before deciding the state — present for
   * every state except `identity-unavailable`, so a consumer that needs the worktree root (the
   * prompt-history project key) reads the one resolution already made instead of resolving again.
   */
  readonly identity?: IWorkspaceIdentity;
  /** Present when the state was caused by a swallowed identity/store error a diagnostic should name. */
  readonly cause?: IWorkspaceTrustCause;
}

export type TWorkspaceProjectAccess =
  ITrustedWorkspaceProjectAccess | IRestrictedWorkspaceProjectAccess;
