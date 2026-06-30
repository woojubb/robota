/**
 * Root-aware, nesting-aware enumeration of workspace package directories under `packages/`.
 *
 * Several harness scans used a one-level `readdirSync('packages')` loop and therefore silently
 * skipped NESTED package groups (e.g. `packages/dag-nodes/<name>`) — under-covering those packages
 * (INFRA-021; the same defect class guarded for build/CI globs by check-nested-package-glob-coverage).
 * This is the single owner of "what package directories exist", parameterized by `root` so the scans
 * and their fixture-based tests share it.
 *
 * A depth-1 directory under `packages/` that carries the requested marker is a package; a depth-1
 * directory WITHOUT it is treated as a group container and recursed exactly one level.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);

function childDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.'),
    )
    .map((entry) => path.join(dir, entry.name));
}

/**
 * List package directories under `<root>/packages`, including nested group members. `hasMarker(dir)`
 * decides whether a directory is a package (e.g. it owns `docs/SPEC.md`, or a `package.json`). A
 * depth-1 directory that is not itself a package is recursed one level to find nested members.
 */
export function listPackageDirs(root, hasMarker) {
  const packagesDir = path.join(root, 'packages');
  const dirs = [];
  for (const dir of childDirs(packagesDir)) {
    if (hasMarker(dir)) {
      dirs.push(dir);
      continue;
    }
    for (const nested of childDirs(dir)) {
      if (hasMarker(nested)) dirs.push(nested);
    }
  }
  return dirs;
}

/** Package directories that own a `docs/SPEC.md`. */
export function listSpecPackageDirs(root) {
  return listPackageDirs(root, (dir) => existsSync(path.join(dir, 'docs', 'SPEC.md')));
}

/** Package directories that own a `package.json`. */
export function listManifestPackageDirs(root) {
  return listPackageDirs(root, (dir) => existsSync(path.join(dir, 'package.json')));
}
