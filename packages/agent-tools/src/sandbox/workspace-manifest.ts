import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, posix, resolve } from 'node:path';
import type {
  ISandboxClient,
  IWorkspaceManifest,
  IWorkspaceManifestAppliedEntry,
  IWorkspaceManifestApplyOptions,
  IWorkspaceManifestApplyResult,
  TWorkspaceManifestEntry,
} from './types.js';

const DEFAULT_TARGET_ROOT = '/workspace';
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const SHELL_QUOTE_PATTERN = /'/g;

export async function applyWorkspaceManifest(
  sandboxClient: ISandboxClient,
  manifest: IWorkspaceManifest,
  options: IWorkspaceManifestApplyOptions = {},
): Promise<IWorkspaceManifestApplyResult> {
  if (sandboxClient.applyManifest) {
    return sandboxClient.applyManifest(manifest, options);
  }

  const targetRoot = normalizeSandboxRoot(options.targetRoot ?? DEFAULT_TARGET_ROOT);
  const appliedEntries: IWorkspaceManifestAppliedEntry[] = [];

  for (const [rawPath, entry] of Object.entries(manifest.entries)) {
    const path = validateWorkspaceManifestPath(rawPath);
    const targetPath = joinSandboxPath(targetRoot, path);
    appliedEntries.push(
      await applyManifestEntry(sandboxClient, path, targetPath, targetRoot, entry, options),
    );
  }

  return { entries: appliedEntries };
}

export function validateWorkspaceManifestPath(path: string): string {
  if (path.length === 0) {
    throw new Error('workspace manifest path must not be empty');
  }
  if (path.includes('\0')) {
    throw new Error('workspace manifest path must not contain NUL bytes');
  }
  if (path.startsWith('/') || path.startsWith('\\') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)) {
    throw new Error('workspace manifest path must be workspace-relative');
  }

  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('workspace manifest path must not resolve to the workspace root');
  }
  if (parts.some((part) => part === '..')) {
    throw new Error('workspace manifest path cannot contain traversal segments');
  }

  const normalizedParts = parts.filter((part) => part !== '.');
  if (normalizedParts.length === 0) {
    throw new Error('workspace manifest path must not resolve to the workspace root');
  }

  return normalizedParts.join('/');
}

async function applyManifestEntry(
  sandboxClient: ISandboxClient,
  path: string,
  targetPath: string,
  targetRoot: string,
  entry: TWorkspaceManifestEntry,
  options: IWorkspaceManifestApplyOptions,
): Promise<IWorkspaceManifestAppliedEntry> {
  switch (entry.type) {
    case 'file':
      await writeSandboxFile(sandboxClient, targetPath, targetRoot, entry.content);
      return createAppliedEntry(path, entry.type);
    case 'dir':
      await createSandboxDirectory(sandboxClient, targetPath);
      return createAppliedEntry(path, entry.type);
    case 'localFile':
      await copyLocalFile(sandboxClient, entry.src, targetPath, targetRoot, options);
      return createAppliedEntry(path, entry.type);
    case 'localDir':
      await copyLocalDirectory(sandboxClient, entry.src, targetPath, options);
      return createAppliedEntry(path, entry.type);
    case 'gitRepo':
      await cloneGitRepository(sandboxClient, entry, targetPath);
      return createAppliedEntry(path, entry.type);
    case 's3Mount':
    case 'gcsMount':
    case 'r2Mount':
    case 'azureBlobMount':
      return {
        path,
        type: entry.type,
        status: 'unsupported',
        message: `${entry.type} requires a provider-specific sandbox adapter.`,
      };
    default:
      return assertUnreachable(entry);
  }
}

function createAppliedEntry(
  path: string,
  type: TWorkspaceManifestEntry['type'],
): IWorkspaceManifestAppliedEntry {
  return { path, type, status: 'applied' };
}

async function copyLocalFile(
  sandboxClient: ISandboxClient,
  source: string,
  targetPath: string,
  targetRoot: string,
  options: IWorkspaceManifestApplyOptions,
): Promise<void> {
  const hostSourcePath = resolveHostSourcePath(source, options.hostRoot);
  const content = await readFile(hostSourcePath, 'utf8');
  await writeSandboxFile(sandboxClient, targetPath, targetRoot, content);
}

async function copyLocalDirectory(
  sandboxClient: ISandboxClient,
  source: string,
  targetPath: string,
  options: IWorkspaceManifestApplyOptions,
): Promise<void> {
  const hostSourcePath = resolveHostSourcePath(source, options.hostRoot);
  await copyLocalDirectoryRecursive(sandboxClient, hostSourcePath, targetPath);
}

async function copyLocalDirectoryRecursive(
  sandboxClient: ISandboxClient,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await createSandboxDirectory(sandboxClient, targetPath);
  const entries = await readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    const childSourcePath = join(sourcePath, entry.name);
    const childTargetPath = joinSandboxPath(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyLocalDirectoryRecursive(sandboxClient, childSourcePath, childTargetPath);
      continue;
    }
    if (entry.isFile()) {
      const content = await readFile(childSourcePath, 'utf8');
      await sandboxClient.writeFile(childTargetPath, content);
    }
  }
}

async function cloneGitRepository(
  sandboxClient: ISandboxClient,
  entry: Extract<TWorkspaceManifestEntry, { type: 'gitRepo' }>,
  targetPath: string,
): Promise<void> {
  const shallowArgs = entry.shallow === false ? '' : ' --depth 1';
  const refArgs = entry.ref ? ` --branch ${quoteShellArg(entry.ref)}` : '';
  await runSandboxCommand(
    sandboxClient,
    `git clone${shallowArgs}${refArgs} ${quoteShellArg(entry.url)} ${quoteShellArg(targetPath)}`,
  );
}

async function writeSandboxFile(
  sandboxClient: ISandboxClient,
  targetPath: string,
  targetRoot: string,
  content: string,
): Promise<void> {
  const parentPath = posix.dirname(targetPath);
  if (parentPath !== targetRoot) {
    await createSandboxDirectory(sandboxClient, parentPath);
  }
  await sandboxClient.writeFile(targetPath, content);
}

async function createSandboxDirectory(
  sandboxClient: ISandboxClient,
  targetPath: string,
): Promise<void> {
  await runSandboxCommand(sandboxClient, `mkdir -p ${quoteShellArg(targetPath)}`);
}

async function runSandboxCommand(sandboxClient: ISandboxClient, command: string): Promise<void> {
  const result = await sandboxClient.run(command);
  if (result.exitCode !== 0) {
    throw new Error(
      `workspace manifest command failed: ${command}\n${result.stderr ?? result.stdout}`,
    );
  }
}

function resolveHostSourcePath(source: string, hostRoot: string | undefined): string {
  return isAbsolute(source) ? resolve(source) : resolve(hostRoot ?? process.cwd(), source);
}

function normalizeSandboxRoot(root: string): string {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized.startsWith('/')) {
    throw new Error('workspace manifest targetRoot must be an absolute sandbox path');
  }
  return normalized.length === 0 ? '/' : normalized;
}

function joinSandboxPath(root: string, path: string): string {
  const normalizedRoot = normalizeSandboxRoot(root);
  if (normalizedRoot === '/') {
    return `/${path}`;
  }
  return `${normalizedRoot}/${path}`;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(SHELL_QUOTE_PATTERN, "'\\''")}'`;
}

function assertUnreachable(value: never): never {
  throw new Error(`unsupported workspace manifest entry: ${JSON.stringify(value)}`);
}
