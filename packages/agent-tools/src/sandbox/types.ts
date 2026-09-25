export interface ISandboxRunOptions {
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface ISandboxRunResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export interface IWorkspaceManifestFileEntry {
  type: 'file';
  content: string;
  encoding?: 'utf8';
}

export interface IWorkspaceManifestDirectoryEntry {
  type: 'dir';
}

export interface IWorkspaceManifestLocalFileEntry {
  type: 'localFile';
  src: string;
}

export interface IWorkspaceManifestLocalDirectoryEntry {
  type: 'localDir';
  src: string;
}

export interface IWorkspaceManifestGitRepositoryEntry {
  type: 'gitRepo';
  url: string;
  ref?: string;
  shallow?: boolean;
}

export interface IWorkspaceManifestS3MountEntry {
  type: 's3Mount';
  bucket: string;
  prefix?: string;
  region: string;
}

export interface IWorkspaceManifestGcsMountEntry {
  type: 'gcsMount';
  bucket: string;
  prefix?: string;
}

export interface IWorkspaceManifestR2MountEntry {
  type: 'r2Mount';
  bucket: string;
  accountId: string;
  prefix?: string;
}

export interface IWorkspaceManifestAzureBlobMountEntry {
  type: 'azureBlobMount';
  container: string;
  account: string;
  prefix?: string;
}

export type TWorkspaceManifestEntry =
  | IWorkspaceManifestFileEntry
  | IWorkspaceManifestDirectoryEntry
  | IWorkspaceManifestLocalFileEntry
  | IWorkspaceManifestLocalDirectoryEntry
  | IWorkspaceManifestGitRepositoryEntry
  | IWorkspaceManifestS3MountEntry
  | IWorkspaceManifestGcsMountEntry
  | IWorkspaceManifestR2MountEntry
  | IWorkspaceManifestAzureBlobMountEntry;

export interface IWorkspaceManifestPermissions {
  read?: string[];
  write?: string[];
}

export interface IWorkspaceManifest {
  entries: Record<string, TWorkspaceManifestEntry>;
  environment?: Record<string, string>;
  permissions?: IWorkspaceManifestPermissions;
}

export interface IWorkspaceManifestApplyOptions {
  targetRoot?: string;
  hostRoot?: string;
}

export type TWorkspaceManifestApplyStatus = 'applied' | 'unsupported';

export interface IWorkspaceManifestAppliedEntry {
  path: string;
  type: TWorkspaceManifestEntry['type'];
  status: TWorkspaceManifestApplyStatus;
  message?: string;
}

export interface IWorkspaceManifestApplyResult {
  entries: IWorkspaceManifestAppliedEntry[];
}

/**
 * How a sandbox's filesystem relates to the host's (issue #3081).
 *
 * - `shared` — OS-level confinement of commands over the host filesystem (Seatbelt, bubblewrap).
 *   File tools stay on the host, bounded by the path guard and the permission rules.
 * - `separate` — a remote or VM filesystem (E2B, in-memory). EVERY file tool must route through the
 *   sandbox, or a search would read one filesystem while an edit writes another.
 */
export type TSandboxFilesystem = 'shared' | 'separate';

/** A process to start: the executable, its arguments, and where it runs. */
export interface ICommandInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface ISandboxClient {
  /** Absent means `separate`: every client before this field existed had its own filesystem. */
  readonly filesystem?: TSandboxFilesystem;
  /**
   * A `shared` client that confines a host process in place: the shell tool starts the returned
   * invocation itself, so timeouts, cancellation, output limits and process-group kill stay the
   * tool's. Returning the invocation unchanged runs the command unconfined.
   */
  wrapCommand?(invocation: ICommandInvocation, shellCommand: string): ICommandInvocation;
  /**
   * Whether this client confines `shellCommand` and its settings let a confined command run without
   * a prompt. The permission gate still refuses or asks first for deny rules, ask rules and the
   * never-auto set.
   */
  autoApproves?(shellCommand: string): boolean;
  run(command: string, options?: ISandboxRunOptions): Promise<ISandboxRunResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  applyManifest?(
    manifest: IWorkspaceManifest,
    options?: IWorkspaceManifestApplyOptions,
  ): Promise<IWorkspaceManifestApplyResult>;
  /** Return a provider-owned resumable workspace reference. */
  snapshot?(): Promise<string>;
  /** Hydrate this client from a provider-owned workspace reference. */
  restore?(snapshotId: string): Promise<void>;
}

export interface ISandboxToolOptions {
  sandboxClient?: ISandboxClient;
  /** Abort a host file read between bounded chunks. */
  signal?: AbortSignal;
  /**
   * The tool's working-directory root on the host (non-sandbox) path. REQUIRED — ARCH-010.
   *
   * For the tools that read and enumerate — `Read`/`Write`/`Edit` and, since SEC-007, `Glob`/`Grep` —
   * this is a CONTAINMENT boundary: access outside it is refused, decided on canonical (symlink-
   * resolved) paths. For `Shell`/`Bash` it is the DEFAULT working directory and deliberately not a
   * boundary — a cwd guard on arbitrary command execution is undone by the first `cd` (see the
   * shell-tool file header).
   *
   * It is required because it was optional: with no root the containment guard used to answer
   * "allowed", so a construction site that simply forgot supplied an unsandboxed `Read`. The audit
   * found three layers that had. Optional here means the boundary is a convention each caller may or
   * may not follow, and a boundary nobody is obliged to supply is not a boundary. Callers that
   * genuinely mean "this process's directory" now say `process.cwd()` where a reader can see it.
   */
  cwd: string;
}
