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

export interface ISandboxClient {
  run(command: string, options?: ISandboxRunOptions): Promise<ISandboxRunResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  applyManifest?(
    manifest: IWorkspaceManifest,
    options?: IWorkspaceManifestApplyOptions,
  ): Promise<IWorkspaceManifestApplyResult>;
  snapshot?(): Promise<string>;
  restore?(snapshotId: string): Promise<void>;
}

export interface ISandboxToolOptions {
  sandboxClient?: ISandboxClient;
}
