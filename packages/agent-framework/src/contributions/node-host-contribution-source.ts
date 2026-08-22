import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { IContributionSource } from './contribution-source.js';
import type {
  IWorkspaceDirectoryEntry,
  TWorkspaceContributionKind,
} from '../workspace-trust/index.js';

function resolveWithinHostRoot(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error('Host contribution path must stay relative to its explicit root.');
  }
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(root, candidate);
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Host contribution path must stay relative to its explicit root.');
  }
  return candidate;
}

function classifyHostEntry(path: string): TWorkspaceContributionKind | undefined {
  try {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) return 'link';
    if (stats.isFile()) return 'file';
    if (stats.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Explicit root-bounded adapter for host-owned contribution content. */
export function createNodeHostContributionSource(root: string): IContributionSource {
  const resolvedRoot = resolve(root);
  return Object.freeze({
    kind: 'host' as const,
    displayName: resolvedRoot,
    readText(relativePath: string): string | undefined {
      const path = resolveWithinHostRoot(resolvedRoot, relativePath);
      if (classifyHostEntry(path) === undefined) return undefined;
      return readFileSync(path, 'utf8');
    },
    listDirectory(relativePath: string): readonly IWorkspaceDirectoryEntry[] {
      const path = resolveWithinHostRoot(resolvedRoot, relativePath);
      if (classifyHostEntry(path) === undefined) return [];
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? 'link'
          : entry.isFile()
            ? 'file'
            : entry.isDirectory()
              ? 'directory'
              : 'other',
      }));
    },
    inspectKind(relativePath: string): TWorkspaceContributionKind | undefined {
      return classifyHostEntry(resolveWithinHostRoot(resolvedRoot, relativePath));
    },
  });
}
