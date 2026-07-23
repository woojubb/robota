#!/usr/bin/env node
/**
 * HARNESS-041 — mechanical floor for accidental-green regression tests.
 *
 * A regression test for a `fix:` is worthless if it also passes on the buggy pre-fix code
 * ("accidental-green"). This is the mechanical backstop for the `pr-review-reviewer` guardian and the
 * tdd-and-planning.md "Prove the regression test RED" rule.
 *
 * Approach (single-mutant, PR-diff-scoped — see .agents/spec-docs/active/HARNESS-041-*.md):
 * the intended mutation IS the inverse of the PR's own source diff. For each SAME-PACKAGE (source+test)
 * pair in a `fix:` range, reverse-apply the source hunks onto the working tree (vitest transforms `src`
 * on the fly, so no rebuild is needed for a relative same-package import), run the changed test files,
 * and require a genuine assertion FAILURE. All-pass ⇒ accidental-green. A vitest RUN error (transform /
 * collection / missing module) is INCONCLUSIVE, never a pass (C1).
 *
 * The pure decision logic (classify → scope → verdict) is exported and unit-tested through injected
 * "diff provider" + "test runner" seams; the git/vitest side effects live in the orchestrator.
 */

import { execFileSync } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// ── Verdict vocabulary ────────────────────────────────────────────────────────────────────────────
export const VERDICT = Object.freeze({
  RED_PROOF_OK: 'red-proof-ok', // ≥1 changed test genuinely fails with the fix reversed — good
  ACCIDENTAL_GREEN: 'accidental-green-fail', // all changed tests still pass — the defect this tool exists to catch
  INCONCLUSIVE: 'inconclusive', // vitest could not evaluate, or the test does not import the reversed file
  SKIPPED_NOT_FIX: 'skipped-not-fix', // range has no fix: commit
  SKIPPED_NO_PAIR: 'skipped-no-pair', // no same-package source+test pair
  SKIPPED_OPT_OUT: 'skipped-opt-out', // allow-green-at-base: <reason>
});

// ── Pure: file classification ─────────────────────────────────────────────────────────────────────

/** Package/app root key for a repo-relative path, or null if not under a package/app `src`. */
export function pkgOf(filePath) {
  const m = filePath.match(/^((?:packages|apps)\/[^/]+)\/src\//);
  return m ? m[1] : null;
}

export function isTestFile(filePath) {
  return /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\//.test(filePath);
}

/** A source file is a package/app `src` file that is NOT a test file. */
export function isSourceFile(filePath) {
  return pkgOf(filePath) !== null && !isTestFile(filePath);
}

/**
 * Split changed files into same-package (source, test) pairs.
 * Returns a Map keyed by package root → { source: string[], test: string[] }.
 */
export function classifyChanges(changedFiles) {
  const byPkg = new Map();
  for (const f of changedFiles) {
    const pkg = pkgOf(f);
    if (!pkg) continue;
    if (!byPkg.has(pkg)) byPkg.set(pkg, { source: [], test: [] });
    if (isTestFile(f)) byPkg.get(pkg).test.push(f);
    else byPkg.get(pkg).source.push(f);
  }
  return byPkg;
}

/** Packages that changed BOTH source and test — the only ones this v1 can red-prove. */
export function qualifyingPairs(byPkg) {
  const pairs = [];
  for (const [pkg, { source, test }] of byPkg) {
    if (source.length > 0 && test.length > 0) pairs.push({ pkg, source, test });
  }
  return pairs;
}

// ── Pure: range + opt-out scoping (C2, opt-out) ─────────────────────────────────────────────────────

/** A defect-fix range has a `fix:` / `fix(scope): ` conventional commit. `perf:` is intentionally excluded. */
export function isDefectFixRange(commitSubjects) {
  return commitSubjects.some((s) => /^fix(\(|:)/.test(s.trim()));
}

/** Parse `allow-green-at-base: <reason>` (opt-out) from any text (PR body / commit trailers). */
export function parseOptOut(text) {
  const m = (text || '').match(/allow-green-at-base:\s*(\S.*)/i);
  const reason = m ? m[1].trim() : null;
  return { optedOut: Boolean(reason), reason };
}

// ── Pure: vitest outcome classification (C1 — the correctness-critical distinction) ──────────────────

/**
 * Given vitest `--reporter=json` output (parsed) and the changed test files, classify the outcome.
 * NEVER conflate a genuine assertion failure with a run error.
 *   'assertion-fail' — ≥1 changed test file has a failed assertion (the suite ran and the test failed)
 *   'run-error'      — a changed test file could not be evaluated (transform/collection/missing module)
 *   'all-pass'       — every changed test file ran and passed
 */
export function classifyVitestOutcome(vitestJson, changedTestFiles) {
  const wanted = changedTestFiles.map((f) => path.resolve(WORKSPACE_ROOT, f));
  const results = Array.isArray(vitestJson?.testResults) ? vitestJson.testResults : [];
  let sawAssertionFail = false;
  const ranWithAssertions = new Set();

  for (const fileResult of results) {
    const name = fileResult?.name ? path.resolve(fileResult.name) : null;
    if (!name || !wanted.includes(name)) continue;
    const assertions = Array.isArray(fileResult.assertionResults)
      ? fileResult.assertionResults
      : [];
    if (assertions.length === 0) continue; // present but no assertions → failed to collect/transform
    ranWithAssertions.add(name);
    if (assertions.some((a) => a.status === 'failed')) sawAssertionFail = true;
  }

  // C1 — a genuine assertion failure is the ONLY pass. ANY wanted test file that did not run with
  // assertions (missing from results OR present-with-zero-assertions — a transform/collection error) is a
  // run-error and yields INCONCLUSIVE, even if a SIBLING changed test file ran green. Never conflate a
  // non-run with all-pass: that would be a false accidental-green alarm.
  if (sawAssertionFail) return 'assertion-fail';
  const sawRunError = wanted.some((abs) => !ranWithAssertions.has(abs));
  if (sawRunError) return 'run-error';
  return 'all-pass';
}

// ── Pure: final verdict for one qualifying pair ─────────────────────────────────────────────────────

/**
 * Decide the verdict for a single same-package pair, given the observable inputs. Kept pure so it is
 * unit-tested exhaustively without git or vitest.
 *   importsReversedFile — did any changed test relatively import a reversed source file? (C3)
 *   outcome             — classifyVitestOutcome result, or null if not run (guard tripped)
 */
export function decidePairVerdict({ importsReversedFile, outcome }) {
  if (!importsReversedFile) return VERDICT.INCONCLUSIVE; // C3: not in the test's module graph
  if (outcome === 'assertion-fail') return VERDICT.RED_PROOF_OK;
  if (outcome === 'run-error') return VERDICT.INCONCLUSIVE; // C1: never a pass
  if (outcome === 'all-pass') return VERDICT.ACCIDENTAL_GREEN;
  return VERDICT.INCONCLUSIVE;
}

// ── Pure: relative-import module graph (C3) ─────────────────────────────────────────────────────────

/** Resolve a relative import specifier from an importer file to an on-disk source path, or null. */
export function resolveRelativeImport(importerAbsPath, specifier, fileExists = existsSync) {
  if (!specifier.startsWith('.')) return null;
  const baseDir = path.dirname(importerAbsPath);
  const raw = path.resolve(baseDir, specifier);
  // Map a `.js`/`.jsx`/`.cjs`/`.mjs` specifier to its TS source, plus bare + index resolutions.
  const stripped = raw.replace(/\.[cm]?jsx?$/, '');
  const candidates = [
    raw,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.mts`,
    `${stripped}.cts`,
    `${stripped}.js`,
    `${stripped}.jsx`,
    path.join(stripped, 'index.ts'),
    path.join(stripped, 'index.tsx'),
    path.join(stripped, 'index.mts'),
    path.join(stripped, 'index.js'),
    path.join(stripped, 'index.jsx'),
  ];
  for (const c of candidates) if (fileExists(c)) return c;
  return null;
}

// Strip line + block comments before scanning so commented-out imports do not pollute the graph.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Static `import … from './x'` / `export … from './x'` / side-effect `import './x'`, plus dynamic `import('./x')`.
const RELATIVE_IMPORT_RE =
  /(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*['"](\.[^'"]+)['"]/g;

/** Extract relative import specifiers from a file's text (comments stripped). */
export function relativeSpecifiers(sourceText) {
  const out = [];
  let m;
  const text = stripComments(sourceText);
  RELATIVE_IMPORT_RE.lastIndex = 0;
  while ((m = RELATIVE_IMPORT_RE.exec(text)) !== null) out.push(m[1] || m[2] || m[3]);
  return out;
}

/**
 * Transitive relative-import graph from the changed test files, staying within the package. Returns a Set
 * of absolute source paths reachable via relative imports. Bounded by a visited set + within-package guard.
 */
export function reachableRelativeGraph(
  testAbsPaths,
  pkgAbsRoot,
  readText,
  fileExists = existsSync,
) {
  const visited = new Set();
  const queue = [...testAbsPaths];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (visited.has(cur)) continue;
    visited.add(cur);
    let text;
    try {
      text = readText(cur);
    } catch {
      continue; // unreadable — skip (do not fail the graph walk)
    }
    for (const spec of relativeSpecifiers(text)) {
      const resolved = resolveRelativeImport(cur, spec, fileExists);
      // `+ path.sep` so `packages/x` does not prefix-match a sibling `packages/x-utils`.
      if (resolved && resolved.startsWith(pkgAbsRoot + path.sep) && !visited.has(resolved))
        queue.push(resolved);
    }
  }
  // Remove the test files themselves; callers care about imported sources.
  for (const t of testAbsPaths) visited.delete(t);
  return visited;
}

// ── Impure orchestrator ─────────────────────────────────────────────────────────────────────────────

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8', ...opts }).trim();
}

function mergeBase(ref = 'origin/develop') {
  try {
    return git(['merge-base', ref, 'HEAD']);
  } catch {
    return git(['merge-base', 'develop', 'HEAD']);
  }
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/**
 * Run the checker. Side-effecting parts (diff, commit subjects, opt-out text, vitest) are injected so the
 * orchestration is testable; defaults wire the real git/vitest.
 */
export async function runRegressionRedProof(io = {}) {
  const base = io.mergeBase ?? mergeBase();
  const changedFiles =
    io.changedFiles ??
    git(['diff', '--name-only', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean);
  const commitSubjects =
    io.commitSubjects ??
    git(['log', '--format=%s', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean);
  const optOutText = io.optOutText ?? `${process.env.PR_BODY ?? ''}\n${commitSubjects.join('\n')}`;

  const decisions = [];

  const { optedOut, reason } = parseOptOut(optOutText);
  if (optedOut) {
    log(`↩︎  SKIPPED (opt-out): allow-green-at-base: ${reason}`);
    return { verdict: VERDICT.SKIPPED_OPT_OUT, decisions };
  }
  if (!isDefectFixRange(commitSubjects)) {
    log('↩︎  SKIPPED: range has no `fix:` commit (not a defect fix).');
    return { verdict: VERDICT.SKIPPED_NOT_FIX, decisions };
  }

  const pairs = qualifyingPairs(classifyChanges(changedFiles));
  if (pairs.length === 0) {
    log('↩︎  SKIPPED: no same-package (source+test) pair to red-prove.');
    return { verdict: VERDICT.SKIPPED_NO_PAIR, decisions };
  }

  const readText = io.readText ?? ((p) => fs.readFileSync(p, 'utf8'));
  const fileExists = io.fileExists ?? existsSync;
  const isDirty =
    io.isDirty ?? ((paths) => git(['status', '--porcelain', '--', ...paths]).length > 0);
  const reverseApply =
    io.reverseApply ??
    ((srcPaths) => {
      const patch = git(['diff', `${base}..HEAD`, '--', ...srcPaths]);
      execFileSync('git', ['apply', '-R'], { cwd: WORKSPACE_ROOT, input: patch });
    });
  const restore = io.restore ?? ((srcPaths) => git(['checkout', '--', ...srcPaths]));
  const runVitest = io.runVitest ?? defaultRunVitest;

  let worst = VERDICT.RED_PROOF_OK;
  const rank = {
    [VERDICT.ACCIDENTAL_GREEN]: 3,
    [VERDICT.INCONCLUSIVE]: 2,
    [VERDICT.RED_PROOF_OK]: 1,
  };

  for (const pair of pairs) {
    // C4 — never mutate a dirty tree.
    if (isDirty(pair.source)) {
      log(
        `⚠︎  ${pair.pkg}: source paths have uncommitted edits — refusing to mutate. INCONCLUSIVE.`,
      );
      decisions.push({ pkg: pair.pkg, verdict: VERDICT.INCONCLUSIVE, reason: 'dirty-tree' });
      if (rank[VERDICT.INCONCLUSIVE] > rank[worst]) worst = VERDICT.INCONCLUSIVE;
      continue;
    }

    // C3 — is any reversed source file in the changed test's relative-import graph?
    const pkgAbsRoot = path.resolve(WORKSPACE_ROOT, pair.pkg);
    const testAbs = pair.test.map((t) => path.resolve(WORKSPACE_ROOT, t));
    const graph = reachableRelativeGraph(testAbs, pkgAbsRoot, readText, fileExists);
    const srcAbs = pair.source.map((s) => path.resolve(WORKSPACE_ROOT, s));
    const importsReversedFile = srcAbs.some((s) => graph.has(s));

    let outcome = null;
    if (importsReversedFile) {
      reverseApply(pair.source);
      try {
        outcome = classifyVitestOutcome(await runVitest(pair.pkg, pair.test), pair.test);
      } finally {
        restore(pair.source);
      }
    }

    const verdict = decidePairVerdict({ importsReversedFile, outcome });
    decisions.push({ pkg: pair.pkg, verdict, outcome, importsReversedFile });
    const icon =
      verdict === VERDICT.RED_PROOF_OK ? '✅' : verdict === VERDICT.ACCIDENTAL_GREEN ? '❌' : '⚠︎';
    log(`${icon}  ${pair.pkg}: ${verdict}${outcome ? ` (${outcome})` : ''}`);
    if ((rank[verdict] ?? 0) > (rank[worst] ?? 0)) worst = verdict;
  }

  return { verdict: worst, decisions };
}

function defaultRunVitest(pkg, testFiles) {
  const rel = testFiles.map((f) => path.relative(path.join(WORKSPACE_ROOT, pkg), f));
  try {
    const out = execFileSync(
      'pnpm',
      ['--filter', `./${pkg}`, 'exec', 'vitest', 'run', '--reporter=json', ...rel],
      { cwd: WORKSPACE_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(extractJson(out));
  } catch (err) {
    // vitest exits non-zero on failure; its JSON is still on stdout.
    const stdout = String(err.stdout ?? '');
    try {
      return JSON.parse(extractJson(stdout));
    } catch {
      return { testResults: [] }; // unparseable → classified as run-error by the caller
    }
  }
}

/** vitest may print warnings before the JSON payload; grab the first `{`…matching object heuristically. */
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  runRegressionRedProof()
    .then(({ verdict }) => {
      const enforce = process.env.REGRESSION_RED_PROOF_ENFORCE === '1';
      if (verdict === VERDICT.ACCIDENTAL_GREEN) {
        log(
          '\n❌ accidental-green: a regression test passes even with the fix reversed — it guards nothing.\n' +
            '   Rewrite it to FAIL on the pre-fix code, or opt out with `allow-green-at-base: <reason>`.',
        );
        process.exit(enforce ? 1 : 0); // advisory in v1 (not a required check); flip via env once stable
      }
      if (verdict === VERDICT.INCONCLUSIVE) {
        log('\n⚠︎  inconclusive — see decisions above (advisory).');
      }
      process.exit(0);
    })
    .catch((err) => {
      log(`regression-red-proof: orchestration error — ${err?.message ?? err}`);
      process.exit(0); // never block the pipeline on the checker's own failure (advisory)
    });
}
