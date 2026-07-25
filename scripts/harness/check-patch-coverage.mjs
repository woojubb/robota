#!/usr/bin/env node
/**
 * INFRA-041 — PR patch (diff) coverage: the lines a PR adds/changes must themselves be tested.
 *
 * A global repo-average threshold never guaranteed this — a PR could add untested lines while the
 * average stayed green (and the former global-threshold job, compat-node18, is now removed). This
 * checker computes coverage over ONLY the PR's changed executable lines in package/app `src`.
 *
 * Approach (self-hosted, deterministic — no external service, no python):
 *   changed lines  = `git diff -U0 <merge-base>..HEAD` new-side hunk lines
 *   coverage       = per affected package: `vitest run --coverage --coverage.reporter=lcov`
 *                    (the lcov reporter is injected via CLI flags, so per-package vitest configs
 *                    need no edits; the hoisted root `@vitest/coverage-v8` resolves for packages)
 *   patch coverage = covered changed executable lines / instrumented changed executable lines
 *
 * Honesty invariants:
 *   - If coverage data for an affected package cannot be produced, that package is NO-DATA with an
 *     explicit log and the overall verdict is at best INCONCLUSIVE — never a silent pass.
 *   - A changed source file MISSING from its package's lcov (e.g. a config that set
 *     `coverage.all: false`) is UNINSTRUMENTED and degrades the verdict to INCONCLUSIVE — a file no
 *     test ever loads must not dodge the gate by being invisible to the reporter.
 *   - Changed lines that are not executable (types, comments, blanks — absent from lcov DA records
 *     of an instrumented file) are excluded from the denominator, so docs/type-only PRs are a
 *     clean no-op, not a false failure.
 *
 * ADVISORY in v1 (HARNESS-041 rollout pattern): the CLI always exits 0 unless
 * PATCH_COVERAGE_ENFORCE=1, and even then only BELOW-TARGET fails (INCONCLUSIVE stays advisory,
 * matching check-regression-red-proof.mjs). Flip to a required check once calibrated on real PRs.
 *
 * Red-proof: `--fixture <dir>` runs the full pipeline on an on-disk (diff.patch + lcov.info)
 * fixture — `scripts/harness/__tests__/fixtures/patch-coverage/{red,green}` prove the gate goes
 * RED on an untested added function and GREEN once it is covered (see the unit test).
 *
 * The decision logic is pure and exported; git/vitest side effects live in the orchestrator and
 * are injectable (same seam pattern as check-regression-red-proof.mjs).
 */

import { execFileSync } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_TARGET = 80;

// ── Verdict vocabulary ────────────────────────────────────────────────────────────────────────────
export const VERDICT = Object.freeze({
  OK: 'patch-coverage-ok', // measured changed lines meet the target
  BELOW_TARGET: 'patch-coverage-below-target', // the defect this gate exists to catch
  INCONCLUSIVE: 'inconclusive-no-data', // coverage data missing/partial — never a silent pass
  SKIPPED_NO_COVERABLE: 'skipped-no-coverable-changes', // no package/app src lines changed
});

// ── Pure: file classification ─────────────────────────────────────────────────────────────────────

export function isTestFile(filePath) {
  return /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\/|(^|\/)tests?\//.test(filePath);
}

/**
 * Nearest package/app root for a repo-relative path: the deepest ancestor directory under
 * `packages/` or `apps/` that has a package.json. Handles nested workspace groups
 * (e.g. `packages/dag-nodes/<pkg>`) without hardcoding them — depth is discovered, not assumed.
 * `hasPkgJson(dirRel)` is injectable for tests/fixtures.
 */
export function packageRootOf(filePath, hasPkgJson) {
  if (!/^(packages|apps)\//.test(filePath)) return null;
  let dir = path.posix.dirname(filePath);
  while (dir !== '.' && dir !== 'packages' && dir !== 'apps') {
    if (hasPkgJson(dir)) return dir;
    dir = path.posix.dirname(dir);
  }
  return null;
}

/** Coverable = a non-test TS/JS file under `<pkgRoot>/src/` (excluding `.d.ts`). */
export function isCoverableSource(filePath, pkgRoot) {
  if (!filePath.startsWith(`${pkgRoot}/src/`)) return false;
  if (isTestFile(filePath)) return false;
  if (filePath.endsWith('.d.ts')) return false;
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

/** Group the coverable subset of changed files by package root. Map pkgRoot → repo-relative files. */
export function groupCoverableChanges(changedFiles, hasPkgJson) {
  const byPkg = new Map();
  for (const f of changedFiles) {
    const pkgRoot = packageRootOf(f, hasPkgJson);
    if (!pkgRoot || !isCoverableSource(f, pkgRoot)) continue;
    if (!byPkg.has(pkgRoot)) byPkg.set(pkgRoot, []);
    byPkg.get(pkgRoot).push(f);
  }
  return byPkg;
}

// ── Pure: unified-diff (-U0) new-side line extraction ────────────────────────────────────────────

/**
 * Parse `git diff -U0` text into Map(repo-relative new path → Set(new-side line numbers)).
 * Hunk header: `@@ -a[,b] +c[,d] @@` — new lines are c..c+d-1 (d defaults to 1; d=0 = pure deletion).
 * Deleted files (`+++ /dev/null`) contribute nothing.
 */
export function parseChangedNewLines(diffText) {
  const byFile = new Map();
  let current = null;
  for (const line of diffText.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ (?:b\/(.*)|\/dev\/null)$/);
    if (fileMatch) {
      current = fileMatch[1] ?? null;
      if (current && !byFile.has(current)) byFile.set(current, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let i = 0; i < count; i += 1) byFile.get(current).add(start + i);
    }
  }
  for (const [file, lines] of byFile) if (lines.size === 0) byFile.delete(file);
  return byFile;
}

// ── Pure: lcov parsing ────────────────────────────────────────────────────────────────────────────

/**
 * Parse lcov text into Map(repo-relative path → Map(line → hits)). `SF:` paths may be absolute or
 * relative to the emitting package (`pkgRoot`, repo-relative) — both are normalized. Duplicate SF
 * records merge by max hits (a line covered in any run is covered).
 */
export function parseLcov(lcovText, pkgRoot = '') {
  const byFile = new Map();
  let currentLines = null;
  for (const raw of lcovText.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const sf = line.slice(3).trim();
      const abs = path.isAbsolute(sf) ? sf : path.resolve(WORKSPACE_ROOT, pkgRoot, sf);
      const rel = path.relative(WORKSPACE_ROOT, abs).split(path.sep).join('/');
      if (!byFile.has(rel)) byFile.set(rel, new Map());
      currentLines = byFile.get(rel);
    } else if (line.startsWith('DA:') && currentLines) {
      const [lineNo, hits] = line.slice(3).split(',').map(Number);
      if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
        currentLines.set(lineNo, Math.max(currentLines.get(lineNo) ?? 0, hits));
      }
    } else if (line === 'end_of_record') {
      currentLines = null;
    }
  }
  return byFile;
}

// ── Pure: patch-coverage computation ──────────────────────────────────────────────────────────────

/**
 * Compute per-file and total patch coverage.
 *   changedLinesByFile — Map(file → Set(lines)) restricted to coverable files
 *   lcovByFile         — Map(file → Map(line → hits)) merged across packages
 * A coverable changed file absent from lcov is UNINSTRUMENTED (tracked, not silently dropped).
 * Changed lines absent from an instrumented file's DA records are non-executable and excluded.
 */
export function computePatchCoverage(changedLinesByFile, lcovByFile) {
  const perFile = [];
  let measured = 0;
  let covered = 0;
  const uninstrumented = [];
  for (const [file, lines] of changedLinesByFile) {
    const da = lcovByFile.get(file);
    if (!da) {
      uninstrumented.push(file);
      perFile.push({ file, measured: 0, covered: 0, missedLines: [], uninstrumented: true });
      continue;
    }
    const missedLines = [];
    let fileMeasured = 0;
    let fileCovered = 0;
    for (const line of [...lines].sort((a, b) => a - b)) {
      const hits = da.get(line);
      if (hits === undefined) continue; // non-executable (comment/type/blank)
      fileMeasured += 1;
      if (hits > 0) fileCovered += 1;
      else missedLines.push(line);
    }
    measured += fileMeasured;
    covered += fileCovered;
    perFile.push({
      file,
      measured: fileMeasured,
      covered: fileCovered,
      missedLines,
      uninstrumented: false,
    });
  }
  return { perFile, measured, covered, uninstrumented };
}

/**
 * Final verdict. BELOW_TARGET dominates INCONCLUSIVE dominates OK:
 *   - no coverable changed files → SKIPPED_NO_COVERABLE
 *   - measured lines below target → BELOW_TARGET (even if other data is missing — a proven hole
 *     is a proven hole)
 *   - any NO-DATA package or UNINSTRUMENTED file → INCONCLUSIVE (missing data is never a pass)
 *   - measured === 0 with full data → OK (the changed lines are all non-executable)
 */
export function decideVerdict({
  coverableFileCount,
  measured,
  covered,
  uninstrumented,
  noDataPackages,
  target,
}) {
  if (coverableFileCount === 0) return VERDICT.SKIPPED_NO_COVERABLE;
  const pct = measured === 0 ? 100 : (covered / measured) * 100;
  if (measured > 0 && pct < target) return VERDICT.BELOW_TARGET;
  if (noDataPackages.length > 0 || uninstrumented.length > 0) return VERDICT.INCONCLUSIVE;
  return VERDICT.OK;
}

// ── Impure orchestrator ─────────────────────────────────────────────────────────────────────────────

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8', ...opts }).trim();
}

function mergeBase() {
  const ref = process.env.PATCH_COVERAGE_BASE_REF ?? 'origin/develop';
  try {
    return git(['merge-base', ref, 'HEAD']);
  } catch {
    return git(['merge-base', ref.replace(/^origin\//, ''), 'HEAD']);
  }
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function defaultHasPkgJson(dirRel) {
  return existsSync(path.join(WORKSPACE_ROOT, dirRel, 'package.json'));
}

/**
 * Run one package's suite with lcov coverage injected via CLI flags; return the lcov text or null
 * (null = NO-DATA, the caller logs and degrades the verdict). The package's coverage dir is wiped
 * first so stale data can never masquerade as fresh. A non-zero vitest exit is tolerated when
 * lcov.info was still produced (e.g. a package-configured global threshold tripping is not this
 * gate's concern), but a missing report is always NO-DATA — never a silent pass.
 */
function defaultCollectLcov(pkgRoot) {
  const covDir = path.join(WORKSPACE_ROOT, pkgRoot, 'coverage');
  fs.rmSync(covDir, { recursive: true, force: true });
  try {
    execFileSync(
      'pnpm',
      [
        '--filter',
        `./${pkgRoot}`,
        'exec',
        'vitest',
        'run',
        '--coverage',
        '--coverage.reporter=lcov',
        '--coverage.reportsDirectory=coverage',
      ],
      { cwd: WORKSPACE_ROOT, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] },
    );
  } catch {
    log(`⚠︎  ${pkgRoot}: vitest exited non-zero — using its lcov output only if present.`);
  }
  const lcovPath = path.join(covDir, 'lcov.info');
  if (!existsSync(lcovPath)) return null;
  return fs.readFileSync(lcovPath, 'utf8');
}

/**
 * Full pipeline. Side effects (diff text, package-json probe, per-package lcov collection) are
 * injected via `io` so the orchestration is unit-testable; defaults wire real git/vitest.
 */
export async function runPatchCoverage(io = {}) {
  const target = Number(io.target ?? process.env.PATCH_COVERAGE_TARGET ?? DEFAULT_TARGET);
  const base = io.diffText === undefined ? mergeBase() : null;
  const diffText = io.diffText ?? git(['diff', '-U0', `${base}..HEAD`]);
  const hasPkgJson = io.hasPkgJson ?? defaultHasPkgJson;
  const collectLcov = io.collectLcov ?? defaultCollectLcov;

  const changedNewLines = parseChangedNewLines(diffText);
  const byPkg = groupCoverableChanges([...changedNewLines.keys()], hasPkgJson);

  const coverableChangedLines = new Map();
  for (const files of byPkg.values()) {
    for (const f of files) coverableChangedLines.set(f, changedNewLines.get(f));
  }
  if (coverableChangedLines.size === 0) {
    log('↩︎  SKIPPED: no coverable package/app src lines changed (docs/config/test-only diff).');
    return { verdict: VERDICT.SKIPPED_NO_COVERABLE, measured: 0, covered: 0, perFile: [] };
  }

  const lcovByFile = new Map();
  const noDataPackages = [];
  for (const pkgRoot of byPkg.keys()) {
    log(`▶  collecting coverage for ${pkgRoot} (${byPkg.get(pkgRoot).length} changed src file(s))`);
    const lcovText = collectLcov(pkgRoot);
    if (lcovText === null) {
      log(
        `⚠︎  ${pkgRoot}: NO-DATA — no lcov report produced; this package's changed lines are UNMEASURED.`,
      );
      noDataPackages.push(pkgRoot);
      continue;
    }
    for (const [file, da] of parseLcov(lcovText, pkgRoot)) {
      const merged = lcovByFile.get(file) ?? new Map();
      for (const [line, hits] of da) merged.set(line, Math.max(merged.get(line) ?? 0, hits));
      lcovByFile.set(file, merged);
    }
  }

  const { perFile, measured, covered, uninstrumented } = computePatchCoverage(
    coverableChangedLines,
    lcovByFile,
  );
  const verdict = decideVerdict({
    coverableFileCount: coverableChangedLines.size,
    measured,
    covered,
    uninstrumented,
    noDataPackages,
    target,
  });

  log('\nPatch coverage over changed lines:');
  for (const f of perFile) {
    if (f.uninstrumented) {
      log(
        `  ⚠︎  ${f.file}: UNINSTRUMENTED (absent from lcov — no test loads it, or coverage excludes it)`,
      );
    } else if (f.measured === 0) {
      log(`  –  ${f.file}: no executable changed lines`);
    } else {
      const pct = ((f.covered / f.measured) * 100).toFixed(1);
      const miss = f.missedLines.length > 0 ? ` — missed lines: ${f.missedLines.join(', ')}` : '';
      log(
        `  ${f.covered === f.measured ? '✅' : '❌'} ${f.file}: ${f.covered}/${f.measured} (${pct}%)${miss}`,
      );
    }
  }
  const totalPct = measured === 0 ? 100 : (covered / measured) * 100;
  log(
    `\nTOTAL: ${covered}/${measured} changed executable lines covered (${totalPct.toFixed(1)}%), target ${target}%`,
  );
  if (noDataPackages.length > 0) log(`NO-DATA packages: ${noDataPackages.join(', ')}`);
  log(`VERDICT: ${verdict}`);
  return { verdict, measured, covered, perFile, uninstrumented, noDataPackages };
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

function writeGithubOutput(lines) {
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

/** `--detect`: list affected packages so the CI job can gate the (heavier) build+test steps. */
function detectMode() {
  const base = mergeBase();
  const diffText = git(['diff', '-U0', `${base}..HEAD`]);
  const byPkg = groupCoverableChanges(
    [...parseChangedNewLines(diffText).keys()],
    defaultHasPkgJson,
  );
  const pkgs = [...byPkg.keys()];
  const affected = pkgs.length > 0;
  log(affected ? `affected packages: ${pkgs.join(', ')}` : 'no coverable package/app src changes.');
  writeGithubOutput([`affected=${affected}`, `packages=${pkgs.join(' ')}`]);
}

/** `--fixture <dir>`: run the pure pipeline over an on-disk diff.patch + lcov.info (red-proof). */
function fixtureIo(dir) {
  const abs = path.resolve(WORKSPACE_ROOT, dir);
  return {
    diffText: fs.readFileSync(path.join(abs, 'diff.patch'), 'utf8'),
    // fixture package roots are the two-segment `packages/<x>` / `apps/<x>` shape
    hasPkgJson: (dirRel) => dirRel.split('/').length === 2,
    collectLcov: () => fs.readFileSync(path.join(abs, 'lcov.info'), 'utf8'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--detect') {
    try {
      detectMode();
    } catch (err) {
      log(`patch-coverage detect error — ${err?.message ?? err}`);
      writeGithubOutput(['affected=false', 'packages=']);
    }
    process.exit(0);
  }
  const io = args[0] === '--fixture' && args[1] ? fixtureIo(args[1]) : {};
  runPatchCoverage(io)
    .then(({ verdict }) => {
      const enforce = process.env.PATCH_COVERAGE_ENFORCE === '1';
      if (verdict === VERDICT.BELOW_TARGET) {
        log(
          '\n❌ patch coverage below target: this PR adds/changes lines no test exercises.\n' +
            '   Add tests for the missed lines above (advisory in v1; enforced when PATCH_COVERAGE_ENFORCE=1).',
        );
        process.exit(enforce ? 1 : 0); // advisory rollout — flip to required once calibrated
      }
      if (verdict === VERDICT.INCONCLUSIVE) {
        log(
          '\n⚠︎  inconclusive — coverage data missing for part of the diff (see NO-DATA/UNINSTRUMENTED above). Advisory.',
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      log(`patch-coverage: orchestration error — ${err?.message ?? err}`);
      process.exit(0); // never block the pipeline on the checker's own failure (advisory)
    });
}
