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

/**
 * ONE exclusion set for the source-file walk (HARNESS-062).
 *
 * Twenty-eight hand-rolled walkers carried six different exclusion sets, so the same file was
 * source to some scans and invisible to others. Measured: a file at `packages/pub/src/dist/legacy.ts`
 * carrying `@deprecated`, `TODO: Implement` and `export class FakeThing` was opened by
 * `stub-markers` and `deprecated-markers` and never opened at all by `no-fake-in-src`, whose walker
 * skipped any directory named `dist`. Whether that file is source is a property of the file, not of
 * which scan is asking.
 *
 * The set is `SKIP_DIRS` above — the exclusions this module already declares for the package walk:
 * an installed dependency tree and build output are not authored source under any scan's definition.
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx'];

/** Directories holding tests rather than shipped source. */
const TEST_DIRS = new Set(['__tests__']);
const TEST_FILE_PATTERN = /\.(test|spec)\./;

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

/**
 * Every source file under `dir`, recursively, as absolute paths.
 *
 * The single owner of "which files a scan opens" (HARNESS-062). `excludeTests` is a NAMED option,
 * not a private fork: `check-interface-imports` deliberately descends into `__tests__` — an
 * import-layering violation in a test file is still a violation — while the marker scans it
 * otherwise mirrors deliberately do not, because a stub marker in a test is a test, not a shipped
 * stub. That divergence is preserved here as a parameter so it is a decision anyone can read,
 * rather than a difference between two walkers nobody compared.
 *
 * @param {string} dir absolute directory to walk; a missing directory yields `[]`
 * @param {{ excludeTests?: boolean, extensions?: string[] | null }} [options]
 *   `extensions: null` keeps every file regardless of extension.
 */
export function listSourceFiles(dir, options = {}) {
  const { excludeTests = true, extensions = SOURCE_EXTENSIONS } = options;
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (excludeTests && TEST_DIRS.has(entry.name)) continue;
      files.push(...listSourceFiles(full, options));
      continue;
    }
    if (!entry.isFile()) continue;
    if (extensions !== null && !extensions.includes(path.extname(entry.name))) continue;
    if (excludeTests && TEST_FILE_PATTERN.test(entry.name)) continue;
    files.push(full);
  }
  return files;
}
