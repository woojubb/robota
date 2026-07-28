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
 *
 * The family directory is a parameter (default `packages`) so a scan that reads its governed tree
 * name from configuration keeps that indirection instead of hard-coding `packages` to reach the
 * nesting-aware walk.
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
export function listPackageDirs(root, hasMarker, family = 'packages') {
  const packagesDir = path.join(root, family);
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

/**
 * `apps/*` members that own a `package.json`.
 *
 * Flat by DECLARATION, not by assumption: `pnpm-workspace.yaml` declares `apps/*` and no
 * `apps/<group>/*` pattern, so a depth-1 read is the whole set. Stated here because the same
 * assumption applied to `packages/` — where the manifest DOES declare a nested pattern — is the
 * defect this module exists to fix.
 */
export function listAppDirs(root) {
  const appsDir = path.join(root, 'apps');
  return childDirs(appsDir).filter((dir) => existsSync(path.join(dir, 'package.json')));
}

/**
 * Every workspace package directory the manifest declares under `packages/` and `apps/`.
 *
 * The set most harness scans mean when they say "every workspace package". Using it instead of a
 * per-scan `for (const family of ['packages', 'apps']) readdirSync(...)` loop is what keeps a scan's
 * universal claim ("scans every implementation package", "checks all publishable packages") true of
 * the nested `packages/dag-nodes/*` group rather than of the 55 members a depth-1 read happens to
 * see. `examples/*` and `scratch` are workspace members too, and are deliberately NOT here: the
 * harness excludes them by design (see `shared.mjs listWorkspaceScopes`).
 */
export function listWorkspacePackageDirs(root) {
  return [...listManifestPackageDirs(root), ...listAppDirs(root)];
}
