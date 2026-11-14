import type { IProcessMarkerHandle } from '@robota-sdk/agent-core';

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
  /** A native host may bind an operation's already-open root to its live approval. */
  assertOpenedRootDescriptor?(descriptor: number): void;
}

export interface IWorkspaceTrustStoreSnapshot {
  readonly state: 'trusted' | 'untrusted' | 'revoked' | 'stale/replaced';
  readonly generation: number;
  readonly grantedAt?: string;
}

/**
 * One recorded grant, as the store persists it. Deep-link handling reads these to resolve a deep
 * link's `repo=owner/name` against clones the user has ALREADY trusted; nothing else enumerates
 * them.
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
   * ever trusted, so it exists for one consumer (deep-link `repo=owner/name` resolution) and
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

/** Host-selected, project-root-relative directories bound to an issued authority. */
export type TWorkspaceProjectStateDirectories = Readonly<
  Record<TWorkspaceProjectStateNamespace, string>
>;

export interface IWorkspaceProjectStateStorage {
  readonly [workspaceProjectStateStorageType]: true;
  readonly namespace: TWorkspaceProjectStateNamespace;
  readonly rootRelativePath: string;
  readText(relativePath: string, purpose: string): string | undefined;
  readBytes(relativePath: string, purpose: string, maxBytes?: number): Uint8Array | undefined;
  writeText(relativePath: string, content: string, purpose: string): void;
  writeBytes(relativePath: string, content: Uint8Array, purpose: string): void;
  /** Acquire a project-bound writer lease, or return undefined while another holds it. */
  acquireWriter?(relativeDirectory: string, purpose: string): IProcessMarkerHandle | undefined;
  /** Atomically claim a new directory, or return false when a plain directory already exists. */
  claimDirectory?(relativePath: string, purpose: string): boolean;
  /**
   * Replaces the file whole: a failure before the new content is in place leaves the previous file as
   * it was.
   */
  replaceBytes(relativePath: string, content: Uint8Array, purpose: string): void;
  appendText(relativePath: string, content: string, purpose: string): void;
  listDirectory(relativePath: string, purpose: string): readonly IWorkspaceDirectoryEntry[];
  deleteFile(relativePath: string, purpose: string): boolean;
  /** Remove a directory of this state and everything under it, as the mutation boundary does. */
  removeDirectory?(
    relativePath: string,
    purpose: string,
    options?: IWorkspaceDirectoryRemovalOptions,
  ): TWorkspaceDirectoryRemoval;
  projectRelativePath(relativePath: string): string;
}

/**
 * The anchored writer behind every authority-bearing project mutation, supplied by the host through
 * {@link IWorkspaceProjectFiles}. A boundary keeps stable-root traversal and operation semantics
 * together, so nothing can reintroduce pathname mutation beside the guarded implementation. Every
 * path is root-relative; the boundary refuses a link, an ancestor that is not a plain directory and a
 * root that no longer is the trusted one.
 */
export interface IWorkspaceProjectMutationBoundary {
  /** Acquire an exclusive writer lease contained by this host's project authority. */
  acquireWriter?(relativeDirectory: string): IProcessMarkerHandle | undefined;
  /** Atomically create a non-link directory; false means a plain directory already exists. */
  claimDirectory?(relativePath: string): boolean;
  write(relativePath: string, content: Uint8Array | string): void;
  /**
   * Replaces the file whole: the content is flushed to a fresh temp file beside it, renamed over the
   * target relative to the same anchored directory, and the directory flushed. A failure before the
   * rename leaves the previous file as it was, never a truncated or half-written one; a failure of
   * the final flush means the new file is in place but not confirmed durable. Stale temp files a
   * crashed replace left for the same name are swept.
   */
  replace(relativePath: string, content: Uint8Array | string): void;
  append(relativePath: string, content: string): void;
  delete(relativePath: string): boolean;
  /**
   * Removes (with `apply`) every temp file a crashed replace left in the directory, by the same rule
   * a replace sweeps its own target's with, and also judged against `migrationStartedAt` (when a
   * migration started, by the filesystem's clock) when given; returns how many there are. A directory
   * that is missing is not created and has none.
   */
  sweepTemporaries(relativeDirectory: string, apply: boolean, migrationStartedAt?: number): number;
  /**
   * How many names the regular file at the path has, opened without following a link; `undefined`
   * when it is missing. A link or anything that is not a regular file is refused.
   */
  linkCount(relativePath: string): number | undefined;
  /**
   * The first half of `replace`: the content flushed to a fresh temp file beside the target, which is
   * left as it is. Returns the temp file's name, for `commitStaged` or `discardStaged`.
   */
  stage(relativePath: string, content: Uint8Array | string): string;
  /** Renames a staged temp file over its target and flushes the directory, as `replace` ends. */
  commitStaged(relativePath: string, temporaryName: string): void;
  /** Removes a staged temp file that was not committed; one already gone is fine. */
  discardStaged(relativePath: string, temporaryName: string): void;
  /**
   * Removes the directory at the path and everything under it, in bounded steps a caller repeats
   * while the result is `partial`. Every directory is reached from a held descriptor chain, never a
   * path string; a link or other non-directory entry is unlinked by name, never followed; a directory
   * on another mount (a bind mount included) is refused before anything under it is touched; a
   * directory is removed only while its name still opens the directory that was emptied, so a
   * replacement swapped in under that name is refused rather than removed. A target that is a link,
   * not a directory or a mount point is refused. Missing ancestors are not created.
   */
  removeDirectory?(
    relativePath: string,
    options?: IWorkspaceDirectoryRemovalOptions,
  ): TWorkspaceDirectoryRemoval;
}

/** How much one directory removal call may do before it answers `partial`. */
export interface IWorkspaceDirectoryRemovalOptions {
  /** Unlinks and `rmdir`s to attempt; at least one is always made, so a retry gets further. */
  readonly maxEntries?: number;
  /** Milliseconds to spend; the default stays well under a brokered request's timeout. */
  readonly maxMs?: number;
}

/**
 * What one directory removal call achieved: `removed` (gone, including when another remover finished
 * it), `absent` (nothing was there), or `partial`, to be called again: the budget ran out, or an entry
 * appeared while the directory was being emptied (`concurrent`).
 */
export type TWorkspaceDirectoryRemoval =
  | { readonly status: 'removed' }
  | { readonly status: 'absent' }
  | { readonly status: 'partial'; readonly reason: 'budget' | 'concurrent' };

/**
 * A writer that holds one project root's directory open across a human approval and writes only
 * while the root's name still identifies that directory. One per approved workflow mutation.
 */
export interface IWorkspaceProjectStableWriter {
  /** Verify that the original root name still identifies the retained directory. */
  assertNamedRoot(): void;
  /** Write UTF-8 only while the original name still identifies the retained root. */
  writeUtf8WhileNamed(relativeSegments: readonly string[], content: string): void;
  close(): void;
}

/**
 * What a host lends the workspace trust service to touch project files. The service binds it to each
 * authority it mints, so a read or a write is possible only through an authority the service issued;
 * nothing else in the framework opens a project path. An implementation owns the guarantee the
 * framework relies on: every read and write is root-relative, refuses a link and an ancestor that was
 * replaced, and fails closed where it cannot prove that. A host that cannot give that guarantee
 * builds no trust service, and its sessions are Restricted.
 */
export interface IWorkspaceProjectFiles {
  /**
   * The bytes of the regular file `segments` name under `root`; `undefined` when it is missing;
   * `'over-budget'` when it is larger than `maxBytes`. A link or a path that cannot be read stably is
   * refused by throwing; whatever is thrown that is not a `WorkspaceAuthorityRequiredError` is
   * reported to the caller as one. The reader revalidates the workspace identity before and after
   * this call.
   */
  readBytes(
    root: string,
    segments: readonly string[],
    maxBytes: number,
  ): Uint8Array | 'over-budget' | undefined;
  /**
   * The entries of the directory `segments` name (the root for none), with each entry's kind and no
   * link followed; `[]` when it is missing. The implementation revalidates `identity` through
   * `identityResolver` itself, around the moment it opens the root, since a directory walk cannot be
   * bracketed from outside.
   */
  listDirectory(
    identity: IWorkspaceIdentity,
    identityResolver: IWorkspaceIdentityResolver,
    segments: readonly string[],
  ): readonly IWorkspaceDirectoryEntry[];
  /** The kind of the entry `segments` name, no link followed; `undefined` when it is missing. */
  inspectKind(
    identity: IWorkspaceIdentity,
    identityResolver: IWorkspaceIdentityResolver,
    segments: readonly string[],
  ): TWorkspaceContributionKind | undefined;
  /** The anchored writer for one authority's root; refuses every operation on a host that cannot anchor. */
  createMutationBoundary(
    identity: IWorkspaceIdentity,
    identityResolver: IWorkspaceIdentityResolver,
  ): IWorkspaceProjectMutationBoundary;
  /** A writer that retains `root` for one approved workflow write. */
  createStableWriter(root: string): IWorkspaceProjectStableWriter;
}

export type TWorkspaceProjectSettingsTarget = 'project' | 'project-local';

export type TWorkspaceProjectSettingsWriteDecision =
  | {
      readonly status: 'approved';
      readonly target: TWorkspaceProjectSettingsTarget;
      /** Host-selected root-relative path for the project settings document. */
      readonly relativePath: string;
      readonly purpose: string;
    }
  | { readonly status: 'denied'; readonly reason: string };

export interface IWorkspaceProjectSettingsWriter {
  readonly [workspaceProjectSettingsWriterType]: true;
  readonly target: TWorkspaceProjectSettingsTarget;
  readonly relativePath: string;
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
 * The owner error behind an `identity-unavailable` or `store-unavailable` trust state. Name and
 * message only — never file content.
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
   * The identity the trust service resolved before deciding the state — present for
   * every state except `identity-unavailable`, so a consumer that needs the worktree root (the
   * prompt-history project key) reads the one resolution already made instead of resolving again.
   */
  readonly identity?: IWorkspaceIdentity;
  /** Present when the state was caused by a swallowed identity/store error a diagnostic should name. */
  readonly cause?: IWorkspaceTrustCause;
}

export type TWorkspaceProjectAccess =
  ITrustedWorkspaceProjectAccess | IRestrictedWorkspaceProjectAccess;

/**
 * Where a session runs and what it may read of that project, as one immutable value.
 * Collaborators receive this value, never copies of its parts, so no lazy operation can hold an
 * answer that differs from the session's.
 */
export interface IWorkspacePolicy {
  readonly cwd: string;
  readonly projectAccess: TWorkspaceProjectAccess;
}
