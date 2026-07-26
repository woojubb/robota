/**
 * Harness check: dist PRESENCE (blocking) + dist FRESHNESS (advisory).
 *
 * WHY BOTH LIVE HERE (HARNESS-053). `pnpm typecheck` resolves a cross-package import to the
 * PRODUCING package's built `dist/*.d.ts`, never to its source. So the dist of every package is a
 * type-surface that the rest of the workspace is compiled against, and its state has two failure
 * directions:
 *
 *   MISSING dist → `TS7016: Could not find a declaration file`. Loud, obvious, already blocking here.
 *   STALE   dist → new consumer source compared against an OLD producer type surface. Silent.
 *
 * The stale direction is symmetric and the quiet half is the dangerous one:
 *
 *   PHANTOM RED  — a healthy branch reported broken. Measured 2026-07-26: `origin/develop` was
 *                  reported to have three `TS2305`/`TS2559` failures. All three were a `dist` built
 *                  07-25 23:44 judged against source from 07-26 07:19; every symbol was in fact
 *                  exported and every signature in fact compatible. `pnpm harness:scan` was GREEN on
 *                  precisely the tree that made `pnpm typecheck` RED, and an agent was dispatched to
 *                  fix code that was already correct.
 *   HIDDEN GREEN — the same staleness makes a consumer that SHOULD fail typecheck pass, because the
 *                  old `.d.ts` still declares the surface the consumer was written against. This
 *                  direction produces no symptom at all. It is what the check is actually for.
 *
 * WHAT THIS FILE USED TO BE, said plainly because HARNESS-052 recorded it: it was named
 * `scan-dist-freshness` and measured only PRESENCE — `touch packages/agent-core/src/index.ts` left
 * the source newer than its dist and the scan still exited 0 reporting "All 86 buildable packages
 * have dist/". The freshness rule below is the repair; the name and the behaviour now agree.
 *
 * THE ORACLE, and its limits — stated rather than implied, because a guard that oversells what it
 * measured is the defect this file was written to close:
 *
 *   Freshness is decided by MTIME: the newest emitted-source file under `src/` versus the newest
 *   artefact under `dist/`. mtime is EVIDENCE, not proof. It is sound in the directions that matter
 *   here and unsound in one that does not:
 *
 *     - fresh clone / cold checkout → git stamps every file at checkout time and `dist` does not
 *       exist at all, so there is nothing to compare and NO staleness is reported. This is the case
 *       that separates a freshness check from the presence check it replaces, and it is pinned by a
 *       test.
 *     - `git checkout <branch>` / rebase / stash pop → the touched sources become newer than a dist
 *       built from the other tree. That dist IS stale. TRUE positive.
 *     - a restored build cache or a downloaded CI artefact → `dist` arrives with a NEW mtime, so a
 *       genuinely stale dist reads as fresh. FALSE NEGATIVE, i.e. this check is silent exactly where
 *       the presence-only check was already silent. It never fabricates a red from it.
 *     - reverting a source file to the exact content its dist was built from → newer mtime, identical
 *       content. FALSE POSITIVE, and the only realistic one. It is why this rule is ADVISORY.
 *
 *   The sound alternative is a CONTENT HASH of the emitted-source set stamped into the build output
 *   at build time and compared here, which removes every mtime caveat above. It is not implemented
 *   because stamping requires changing the build pipeline (`tsdown` config / package build scripts /
 *   the root `build` script), which is outside this item's ownership — not because mtime was judged
 *   sufficient. HARNESS-053 records it as the upgrade path.
 *
 * SEVERITY: presence is an ERROR, freshness is an ADVISORY that never changes the exit code. A
 * freshness rule that hard-failed would redden a legitimately-reverted file, and `ci.yml` already
 * carries a `--skip dist`, so the suppression path for a noisy gate here is literally pre-wired. The
 * blocking enforcement for staleness already exists and is sound: `verify-like-ci`'s `build` stage
 * REBUILDS rather than trusting this scan. This check's job is a legible message at the moment of
 * confusion, not a second gate.
 *
 * VISIBILITY CEILING: `run-all-scans.mjs` discards a PASSING scan's output, so under
 * `pnpm harness:scan` a freshness advisory is counted in this scan's own summary but its per-package
 * lines are not displayed. That is HARNESS-052's open "`run-all-scans` distinguishes ran-and-found-
 * nothing from ran-and-measured-nothing" item, not something this file can fix from inside. Run this
 * scan DIRECTLY — the diagnostic moment it exists for — to see the packages named.
 *
 * Run: node scripts/harness/scan-dist-freshness.mjs
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listWorkspaceScopes, readJson } from './shared.mjs';

const ROOT = process.cwd();

/**
 * Extensions that can contribute to what a build emits, and therefore to the type surface a
 * consumer is compiled against. Deliberately an ALLOWLIST: a `README.md` or a `__snapshots__` blob
 * beside the code moves no declaration, and treating it as source would make the rule fire on a tree
 * whose emitted surface is unchanged — an over-firing advisory is one that gets ignored.
 */
const EMITTED_SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
]);

const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
const NON_EMITTED_DIR_PATTERN = /(^|\/)(__tests__|__mocks__|__fixtures__|__snapshots__)(\/|$)/;

/**
 * Does this `src/`-relative path contribute to the package's emitted output?
 *
 * Tests are excluded on purpose: `tsconfig.build.json` keeps them out of the build, so a touched
 * `*.test.ts` changes no `.d.ts` and a stale verdict drawn from it would be a false alarm.
 */
export function isEmittedSourceFile(relativePath) {
  const normalized = String(relativePath ?? '')
    .split(sep)
    .join('/');
  if (normalized === '') return false;
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (!EMITTED_SOURCE_EXTENSIONS.has(extname(basename))) return false;
  if (TEST_FILE_PATTERN.test(basename)) return false;
  if (NON_EMITTED_DIR_PATTERN.test(normalized)) return false;
  return true;
}

/**
 * Walk `dirPath` recursively, counting accepted files and remembering the newest one.
 *
 * Returns `{ fileCount, newest }` where `newest` is `{ path, mtimeMs }` relative to `dirPath`, or
 * `null` when nothing was accepted. A missing or unreadable directory yields `fileCount: 0` — the
 * CALLERS decide what that means, because for `dist/` it is a presence error and for `src/` it is
 * simply not measurable.
 */
export function walkTree(dirPath, accept = () => true) {
  if (!existsSync(dirPath)) return { fileCount: 0, newest: null };
  let entries;
  try {
    entries = readdirSync(dirPath, { recursive: true, withFileTypes: true });
  } catch {
    return { fileCount: 0, newest: null };
  }

  let fileCount = 0;
  let newest = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = join(entry.parentPath ?? entry.path, entry.name);
    const relativePath = relative(dirPath, fullPath);
    if (!accept(relativePath)) continue;
    fileCount++;
    let mtimeMs;
    try {
      mtimeMs = statSync(fullPath).mtimeMs;
    } catch {
      continue;
    }
    if (newest === null || mtimeMs > newest.mtimeMs) newest = { path: relativePath, mtimeMs };
  }
  return { fileCount, newest };
}

/**
 * Compare the newest emitted source against the newest emitted artefact.
 *
 * `unmeasurable` is a first-class third state, not a pass: "there was nothing to compare" and "the
 * comparison came out clean" are different answers and this scan reports them differently.
 */
export function freshnessVerdict(srcNewest, distNewest) {
  if (!srcNewest) return { state: 'unmeasurable', reason: 'no emitted source files under src/' };
  if (!distNewest) return { state: 'unmeasurable', reason: 'no artefacts under dist/' };
  if (srcNewest.mtimeMs > distNewest.mtimeMs) {
    return { state: 'stale', srcNewest, distNewest, lagMs: srcNewest.mtimeMs - distNewest.mtimeMs };
  }
  return { state: 'fresh', srcNewest, distNewest };
}

function formatLag(lagMs) {
  const seconds = Math.round(lagMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Presence verdict for one scope — pure, so the branching is testable without a filesystem.
 *
 * Returns zero or one result. Note the parenthesised `hasDistExport`: without it, `main` pointing at
 * `dist/` with no `exports` block downgraded a genuine missing-dist ERROR to a non-blocking warning
 * (HARNESS-052 recorded the precedence bug).
 */
export function presenceResults(scope, pkg, hasDist) {
  // Private packages are never published, so their dist presence is a dev concern, not a
  // release/publish gate — but a private package can still carry dist-based `exports`/`main`
  // (e.g. a private server app), so the skip keys on `private`, not on the absence of dist exports.
  if (pkg.private === true) {
    return hasDist
      ? []
      : [
          {
            kind: 'warn',
            message: `${scope.workspaceName}: no dist/ (private, not published — not blocking)`,
          },
        ];
  }

  const hasDistExport = Boolean(
    pkg.main?.includes('dist') || (pkg.exports && JSON.stringify(pkg.exports).includes('dist')),
  );

  if (!hasDistExport && !pkg.bin) {
    // App or internal package with no dist-based exports — warn but don't error
    return hasDist
      ? []
      : [
          {
            kind: 'warn',
            message: `${scope.workspaceName}: no dist/ (app/internal, not blocking)`,
          },
        ];
  }

  if (!hasDist) {
    return [
      {
        kind: 'error',
        message: `${scope.workspaceName} (${scope.relativeDir}): dist/ is missing or empty — run pnpm build first`,
      },
    ];
  }
  return [{ kind: 'ok', message: `${scope.workspaceName}: dist/ present` }];
}

/**
 * Finding collector: classifies each buildable scope's dist state.
 *
 * Returns ordered results (`{ kind: 'ok' | 'warn' | 'error' | 'stale', message }`), the buildable
 * count, and a `freshness` tally so the CLI can report what it MEASURED alongside what it found.
 */
export async function collectDistFreshnessResults(root, scopes) {
  const buildable = scopes.filter((s) => s.scripts.build);
  const results = [];
  const freshness = { measured: 0, fresh: 0, stale: 0, unmeasurable: 0 };

  for (const scope of buildable) {
    const scopeDir = join(root, scope.relativeDir);
    const distWalk = walkTree(join(scopeDir, 'dist'));
    const pkg = await readJson(join(scopeDir, 'package.json'));

    results.push(...presenceResults(scope, pkg, distWalk.fileCount > 0));

    const srcWalk = walkTree(join(scopeDir, 'src'), isEmittedSourceFile);
    const verdict = freshnessVerdict(srcWalk.newest, distWalk.newest);
    if (verdict.state === 'unmeasurable') {
      freshness.unmeasurable++;
      continue;
    }
    freshness.measured++;
    if (verdict.state === 'fresh') {
      freshness.fresh++;
      continue;
    }
    freshness.stale++;
    results.push({
      kind: 'stale',
      message:
        `${scope.workspaceName}: dist/ may be STALE — src/${verdict.srcNewest.path} is ` +
        `${formatLag(verdict.lagMs)} newer than the newest artefact dist/${verdict.distNewest.path}. ` +
        'Cross-package `pnpm typecheck` resolves this package to dist/*.d.ts, so a consumer is being ' +
        'compared against an OLD type surface — it can report a phantom error on correct code, and it ' +
        'can hide a real one. Run `pnpm build` before trusting a typecheck verdict. ADVISORY: mtime ' +
        'is evidence, not proof (see header).',
    });
  }

  return { results, buildableCount: buildable.length, freshness };
}

export async function main() {
  const scopes = await listWorkspaceScopes();
  const { results, buildableCount, freshness } = await collectDistFreshnessResults(ROOT, scopes);

  let errors = 0;
  let warnings = 0;
  // Packages whose dist presence was actually ASSERTED — i.e. that produced an `ok` or `error`.
  // A private or non-dist-exporting package that HAS a dist produces no presence result at all, so
  // the old banner's "All 86 buildable packages have dist/" was a universal claim over 43 of them
  // (measured 2026-07-26). Same shape as HARNESS-052's G1; corrected rather than left standing.
  const presenceAsserted = results.filter((r) => r.kind === 'ok' || r.kind === 'error').length;
  for (const result of results) {
    if (result.kind === 'error') {
      console.error(`\x1b[31m❌ ${result.message}\x1b[0m`);
      errors++;
    } else if (result.kind === 'stale') {
      console.warn(`\x1b[33m🕒 ${result.message}\x1b[0m`);
    } else if (result.kind === 'warn') {
      console.warn(`\x1b[33m⚠️  ${result.message}\x1b[0m`);
      warnings++;
    } else {
      console.log(`\x1b[32m✅ ${result.message}\x1b[0m`);
    }
  }

  console.log('');
  // Reported unconditionally, pass or fail: "ran and measured nothing" must not render the same as
  // "ran and found nothing" (HARNESS-052).
  console.log(
    `freshness: ${freshness.stale} stale / ${freshness.measured} compared ` +
      `(${freshness.unmeasurable} not comparable: no src/ or no dist/). ADVISORY — never blocking.`,
  );
  if (freshness.stale > 0) {
    console.warn(
      `\x1b[33m${freshness.stale} package(s) have a dist/ older than their src/. ` +
        'A cross-package type error seen only in a whole-workspace typecheck should be re-checked ' +
        'after `pnpm build` (or `pnpm harness:verify-like-ci`, which rebuilds) before it is treated ' +
        'as a branch defect.\x1b[0m',
    );
  }

  if (errors > 0) {
    console.error(
      `\x1b[31m${errors} package(s) have missing dist/. Run \`pnpm build\` before pushing.\x1b[0m`,
    );
    process.exit(1);
  } else {
    console.log(
      `\x1b[32mdist/ present on all ${presenceAsserted} package(s) required to have one ` +
        `(of ${buildableCount} buildable; the rest are private or export no dist). ` +
        `${warnings > 0 ? `(${warnings} app/internal warnings)` : ''}\x1b[0m`,
    );
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
