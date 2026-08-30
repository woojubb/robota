import { promises as fs } from 'node:fs';
import path from 'node:path';

import { listWorkspaceScopes, pathExists, readText } from './shared.mjs';

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function collectTypeScriptPaths(root, files) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await collectTypeScriptPaths(target, files);
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.add(target);
  }
}

function createSourceEntry({ absolutePath, packageRoot, sourceRoots, workspaceRoot }) {
  const packageSegments = path.relative(packageRoot, absolutePath).split(path.sep);
  let content;
  return {
    absolutePath,
    relative: path.relative(workspaceRoot, absolutePath),
    underPackages: isWithin(packageRoot, absolutePath),
    inWorkspaceSource: sourceRoots.some((root) => isWithin(root, absolutePath)),
    excludedFromBoundary: packageSegments.some(
      (segment) => segment === 'node_modules' || segment === 'dist',
    ),
    read: () => (content ??= readText(absolutePath)),
  };
}

/**
 * Build one reusable index for every source-text cleanup check.
 *
 * The traversal accepts only real directories/files, preserving `grep -r`'s symlink behavior, and
 * memoizes each file read across all cleanup checks.
 */
export async function buildSourceIndex(workspaceRoot) {
  const scopes = await listWorkspaceScopes();
  const packageRoot = path.join(workspaceRoot, 'packages');
  const sourceRoots = [];
  for (const scope of scopes) {
    const srcDir = path.join(workspaceRoot, scope.relativeDir, 'src');
    if (await pathExists(srcDir)) sourceRoots.push(srcDir);
  }

  const scanRoots = [packageRoot, ...sourceRoots.filter((root) => !isWithin(packageRoot, root))];
  const files = new Set();
  for (const root of scanRoots) {
    if (await pathExists(root)) await collectTypeScriptPaths(root, files);
  }

  return [...files]
    .sort()
    .map((absolutePath) =>
      createSourceEntry({ absolutePath, packageRoot, sourceRoots, workspaceRoot }),
    );
}
