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
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  WITNESS,
  changedNewLines,
  defaultRunVitestRaw,
  witnessDecidingCases,
  witnessOneCase,
} from './lib/execution-witness.mjs';
import {
  EXECUTION,
  analyzeSpawnTargetsCached,
  classifyExecution,
} from './lib/spawn-call-graph.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// ── Verdict vocabulary ────────────────────────────────────────────────────────────────────────────
export const VERDICT = Object.freeze({
  RED_PROOF_OK: 'red-proof-ok', // ≥1 changed test genuinely fails with the fix reversed — good
  // The added case IS red on the reversed source, and executed not one line the fix changed. Its red
  // proves the reversed tree is broken, not that the case depends on the behaviour it names —
  // INFRA-072's "fails for the WRONG REASON", which pass/fail cannot express.
  PROOF_UNREACHED: 'red-proof-unreached',
  ACCIDENTAL_GREEN: 'accidental-green-fail', // all changed tests still pass — the defect this tool exists to catch
  INCONCLUSIVE: 'inconclusive', // vitest could not evaluate, or the test does not import the reversed file
  SKIPPED_NOT_FIX: 'skipped-not-fix', // range has no fix: commit
  SKIPPED_NO_PAIR: 'skipped-no-pair', // no same-package source+test pair
  SKIPPED_OPT_OUT: 'skipped-opt-out', // allow-green-at-base: <reason>
  // INFRA-120: the range ADDED this source and never revised it, so there is no earlier state of it
  // to reverse to. Reversing to `base` deletes it and every case throws, which reads as a verdict and
  // is not one. Named rather than folded into INCONCLUSIVE: the two have different remedies —
  // inconclusive asks for a better pair, this asks for a red proof against a state that exists.
  NO_EARLIER_STATE: 'no-earlier-state',
});

// ── Pure: file classification ─────────────────────────────────────────────────────────────────────

/** The subject whose tests live in the harness suite rather than beside it. */
export const HOOK_SUBJECT = '.claude/hooks';
/** The harness itself — scans, floors and their tests. */
export const HARNESS_SUBJECT = 'scripts/harness';

/**
 * The subject a repo-relative path belongs to, or null when nothing red-proves it.
 *
 * It matched `packages|apps/*​/src/` and nothing else, which made the gate blind to every guard in
 * the repository. Measured over PRs #1525–#1530: twelve CI runs, zero verdicts, nine of them
 * `no same-package pair` — while human review caught four accidental-green tests in that same
 * window, all of them under `scripts/harness/__tests__/` (INFRA-071).
 */
export function pkgOf(filePath) {
  const m = filePath.match(/^((?:packages|apps)\/[^/]+)\/src\//);
  if (m) return m[1];
  // Documentation is not source: reversing a `.md` and re-running a test proves nothing, and a
  // docs-and-test range would otherwise manufacture a pair whose only possible verdict is noise.
  // Under a `packages/*/src` scope this could not arise; under a whole directory it can.
  if (filePath.startsWith(`${HARNESS_SUBJECT}/`))
    return /\.mdx?$/.test(filePath) ? null : HARNESS_SUBJECT;
  if (/^\.claude\/hooks\/.*\.sh$/.test(filePath)) return HOOK_SUBJECT;
  return null;
}

export function isTestFile(filePath) {
  return /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\//.test(filePath);
}

/** A source file is a package/app `src` file that is NOT a test file. */
export function isSourceFile(filePath) {
  return pkgOf(filePath) !== null && !isTestFile(filePath);
}

/**
 * Whether reversing a source hunk changes emitted JavaScript behavior.
 *
 * Vitest cannot prove TypeScript-only contracts red: interfaces and type aliases are erased before
 * execution. Comments likewise have no runtime observable. Treating either as an executable mutant
 * manufactures an accidental-green failure that only typecheck or a documentation scan can settle.
 */
/** An emit that is empty, or only the `export {};` module marker, carries no runtime behaviour. */
const EMPTY_MODULE_EMIT_RE = /^(?:export\s*\{\s*\}\s*;?)?$/;

/**
 * The synthetic base for an ADDED file: an empty MODULE, not an empty file.
 *
 * An empty file has no import or export, so it is emitted as a script and carries a `"use strict";`
 * prologue the module form does not — a difference of framing, not of behaviour, which would read
 * as a runtime mutation for a file that has none.
 */
export const EMPTY_MODULE_SOURCE = 'export {};\n';

export function hasRuntimeSemanticChange(filePath, fixedText, reversedText) {
  if (/\.sh$/.test(filePath)) return fixedText !== reversedText;
  if (!/\.[cm]?[jt]sx?$/.test(filePath)) return fixedText !== reversedText;

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'robota-red-proof-emit-'));
  const outDir = path.join(tempRoot, 'out');
  const extension = path.extname(filePath);
  const fixedPath = path.join(tempRoot, `fixed${extension}`);
  const reversedPath = path.join(tempRoot, `reversed${extension}`);
  try {
    mkdirSync(outDir);
    writeFileSync(fixedPath, fixedText);
    writeFileSync(reversedPath, reversedText);
    execFileSync(
      path.join(WORKSPACE_ROOT, 'node_modules/.bin/tsgo'),
      [
        fixedPath,
        reversedPath,
        '--ignoreConfig',
        '--allowJs',
        '--noCheck',
        '--target',
        'esnext',
        '--module',
        'preserve',
        '--jsx',
        'react-jsx',
        '--removeComments',
        '--outDir',
        outDir,
      ],
      { stdio: 'ignore' },
    );
    const outputs = readdirSync(outDir);
    const emitted = (prefix) => {
      const output = outputs.find((name) => name.startsWith(`${prefix}.`));
      if (!output) throw new Error(`red-proof native emit produced no ${prefix} output`);
      const text = readFileSync(path.join(outDir, output), 'utf8').trim();
      // A module with nothing but types still emits `export {};` — the marker that keeps it a
      // module after every type is erased. Two files whose emit differs only by that marker run
      // identically, and an ADDED type-only module is exactly that case against an empty base.
      // Without this, such a file could never reach the "type/comment-only" verdict its siblings
      // get, and was reported as an accidental-green regression test instead.
      return EMPTY_MODULE_EMIT_RE.test(text) ? '' : text;
    };
    return emitted('fixed') !== emitted('reversed');
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
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

  // A hook's tests do not live beside it — they live in the harness suite, because that is where a
  // test that SPAWNS a shell script belongs. Grouping strictly by path therefore put a changed hook
  // and the test that runs it in different subjects, and they could never form a pair. The harness
  // tests are adopted as candidates here; whether any of them actually exercises the changed hook is
  // the relation check's job, and an unrelated one yields INCONCLUSIVE rather than a false verdict.
  const hooks = byPkg.get(HOOK_SUBJECT);
  const harness = byPkg.get(HARNESS_SUBJECT);
  if (hooks?.source.length && harness?.test.length) {
    hooks.test = [...new Set([...hooks.test, ...harness.test])];
  }
  return byPkg;
}

/**
 * Does this test EXECUTE this hook? The relation that stands in for the import graph when the
 * changed source is a shell script, which is never in one.
 *
 * It used to answer with two INDEPENDENT text checks — the basename appears in the comment-stripped
 * source, and the file spawns `bash` somewhere — with nothing tying the spawn to the name, so a
 * test naming hook A in real code while spawning hook B counted as executing A. That was tolerable
 * while only an advisory coverage message rode on it; INFRA-071 made it pick which tests may SET a
 * red-proof verdict, and a bystander could then decide a hook it never ran. Measured on this tree:
 * one such pair, `check-regression-red-proof.test.mjs` → `branch-guard.sh`, where every `spawnSync`
 * the file contains is inside a STRING LITERAL in a fixture.
 *
 * A narrower text pattern is not the fix and that was established by trying it: requiring the name
 * inside a `path.join(...)` missed every test that hands the basename to a helper which joins it,
 * and those run the hook just as truly. The binding is a VALUE FLOWING THROUGH A CALL, so the
 * answer comes from {@link analyzeSpawnTargetsCached}, which reads it out of the call graph.
 *
 * THREE ANSWERS, and the caller owns what the third one is worth. Ambiguity is real — a path built
 * from `readdirSync()` cannot be pinned — and this gate refuses to let an UNDETERMINED test decide,
 * because a verdict supplied by a test that may not have run the subject is the defect the gate
 * exists to catch. The coverage floor makes the opposite call for its own consequences.
 *
 * @limits basename-only, and it reads ONE module — a test that spawned the hook through a helper
 * imported from another file would read as not executing it. Never guesses: an unresolvable spawn
 * target answers UNDETERMINED.
 */
export function testExecutesHook(testText, hookPath) {
  return classifyExecution(analyzeSpawnTargetsCached(String(testText ?? '')), hookPath);
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
export function isDefectFixRange(commitSubjects, addedFiles = []) {
  if (commitSubjects.some((s) => /^fix(\(|:)/.test(s.trim()))) return true;

  // A range that ADDS A FLOOR is judged too, whatever its subject says. Measured 2026-08-01: five
  // mechanical floors were written in one session and not one was judged by this gate, because a
  // floor lands as `feat:` — it adds a capability — while being a fix for a defect CLASS. Three of
  // the five turned out to pass over the very incident they were built for, and all three were found
  // by a person running them by hand.
  //
  // A floor is the artifact whose red proof matters most: it is what will be trusted to catch the
  // next occurrence, and a floor that cannot fail is worse than none, because it is believed.
  return addedFiles.some((f) => /^scripts\/harness\/__tests__\/.*\.test\.mjs$/.test(f));
}

/** Files changed by commits that individually qualify as defect fixes or add a harness floor. */
export function filesForDefectFixCommits(commits, netChangedFiles = null) {
  const files = new Set();
  const netChanged = netChangedFiles ? new Set(netChangedFiles) : null;
  for (const commit of commits) {
    if (!isDefectFixRange([commit.subject], commit.addedFiles)) continue;
    for (const file of commit.files) {
      if (!netChanged || netChanged.has(file)) files.add(file);
    }
  }
  return [...files];
}

/** Parse `allow-green-at-base: <reason>` (opt-out) from any text (PR body / commit trailers). */
export function parseOptOut(text) {
  const m = (text || '').match(/allow-green-at-base:\s*(\S.*)/i);
  const reason = m ? m[1].trim() : null;
  return { optedOut: Boolean(reason), reason };
}

// ── Pure: which cases the range ADDED (INFRA-072) ────────────────────────────────────────────────────

// `it('…')`, `it.only('…')`, and the table form `it.each(rows)('…')` — the intervening call is what
// makes the last one a separate shape rather than a suffix.
const CASE_TITLE_RE =
  /\b(?:it|test|bench)(?:\.[A-Za-z]+)*(?:\s*\([^()]*\))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * Title matchers for the test cases a diff ADDED.
 *
 * The gate judged at FILE granularity: a changed test file was red-proved when ANY one of its cases
 * failed on the reversed source. So a range could add a vacuous regression test beside a
 * pre-existing case that fails for its own reasons, and the file reported `red-proof-ok` — the same
 * "the unit judged is coarser than the unit the defect lives in" shape INFRA-073 fixed across
 * sources, asked within one file. Measured on `2ac10f251..b1f46acf3`.
 *
 * A template title (`it(\`${hook} is run\`)`) cannot be compared exactly, so its static parts become
 * the matcher and the interpolations become wildcards — a wider match is a weaker check, never a
 * wrong verdict. A title this cannot read at all yields no matcher, and a file with no matchers
 * falls back to file granularity rather than failing something it cannot see.
 */
export function addedCaseTitleMatchers(diffText) {
  const matchers = [];
  for (const line of String(diffText ?? '').split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    CASE_TITLE_RE.lastIndex = 0;
    for (const m of line.slice(1).matchAll(CASE_TITLE_RE)) {
      const [, quote, raw] = m;
      matchers.push(quote === '`' ? templateTitleMatcher(raw) : exactTitleMatcher(raw));
    }
  }
  return matchers;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactTitleMatcher(raw) {
  // The source spelling is escaped; the runtime title is not. Left un-decoded, a title containing
  // `\'` or `\n` would never match its own case, and the file would then report its added case as
  // passing — a false accidental-green from a quoting detail.
  const decoded = raw.replace(/\\(['"\\nt])/g, (_, ch) =>
    ch === 'n' ? '\n' : ch === 't' ? '\t' : ch,
  );
  return new RegExp(`^${escapeRegExp(decoded)}$`);
}

function templateTitleMatcher(raw) {
  const statics = raw.split(/\$\{[^}]*\}/).map(escapeRegExp);
  return new RegExp(`^${statics.join('.*')}$`);
}

/** Did any matcher name this case? Both the bare title and the describe-qualified name are tried. */
function matchesAddedCase(matchers, assertion) {
  const names = [assertion?.title, assertion?.fullName].filter(Boolean);
  return matchers.some((re) => names.some((name) => re.test(name)));
}

// ── Pure: vitest outcome classification (C1 — the correctness-critical distinction) ──────────────────

/**
 * Given vitest `--reporter=json` output (parsed) and the changed test files, classify the outcome.
 * NEVER conflate a genuine assertion failure with a run error.
 *   'assertion-fail'    — ≥1 case that the range ADDED failed (the suite ran and the new test failed)
 *   'added-cases-pass'  — a case failed, but not one this range added: the new test guards nothing
 *   'run-error'         — a changed test file could not be evaluated (transform/collection/missing module)
 *   'all-pass'          — every changed test file ran and passed
 *
 * @param addedCases Map(absolute test path → title matchers for the cases the range added), or null
 *   when the range added no case this can name. Without it the judgement stays at FILE granularity,
 *   which is what let a vacuous new case hide behind a pre-existing failing one (INFRA-072).
 */
export function classifyVitestOutcome(vitestJson, changedTestFiles, addedCases = null) {
  const wanted = changedTestFiles.map((f) => path.resolve(WORKSPACE_ROOT, f));
  const results = Array.isArray(vitestJson?.testResults) ? vitestJson.testResults : [];
  let addedCaseFailed = false; // a failure in a case the range added
  let unjudgedFileFailed = false; // a failure in a file the range added no readable case to
  let judgedFileFailed = false; // a failure ONLY in the older cases of a file the range added to
  const ranWithAssertions = new Set();

  for (const fileResult of results) {
    const name = fileResult?.name ? path.resolve(fileResult.name) : null;
    if (!name || !wanted.includes(name)) continue;
    const assertions = Array.isArray(fileResult.assertionResults)
      ? fileResult.assertionResults
      : [];
    if (assertions.length === 0) continue; // present but no assertions → failed to collect/transform
    ranWithAssertions.add(name);
    const matchers = addedCases?.get(name) ?? null;
    for (const assertion of assertions) {
      if (assertion.status !== 'failed') continue;
      // Per FILE, not across the set. A file the range added no case to is judged the way it always
      // was — its failure is a proof. Demanding a new case there would fail a range whose fix is
      // covered by an existing test in one file and by a new test for a different aspect in
      // another, which is ordinary correct work.
      if (!matchers?.length) unjudgedFileFailed = true;
      else if (matchesAddedCase(matchers, assertion)) addedCaseFailed = true;
      else judgedFileFailed = true;
    }
  }

  // C1 — a genuine assertion failure is the ONLY pass. ANY wanted test file that did not run with
  // assertions (missing from results OR present-with-zero-assertions — a transform/collection error) is a
  // run-error and yields INCONCLUSIVE, even if a SIBLING changed test file ran green. Never conflate a
  // non-run with all-pass: that would be a false accidental-green alarm.
  if (addedCaseFailed || unjudgedFileFailed) return 'assertion-fail';
  const sawRunError = wanted.some((abs) => !ranWithAssertions.has(abs));
  if (sawRunError) return 'run-error'; // a case that never ran has not been shown to pass
  if (judgedFileFailed) return 'added-cases-pass';
  return 'all-pass';
}

/**
 * The failing cases that SUPPLIED the red — the ones an execution witness must account for.
 *
 * It is deliberately the same selection `classifyVitestOutcome` used to reach `assertion-fail`, and
 * not simply "everything that failed": an older case's red is not what the gate accepted as the
 * proof, so it is not what has to be shown to have reached the fix. A file the range added no
 * readable title to is judged at file granularity, and there every failure is a candidate.
 *
 * @returns {{ file: string, name: string, qualified: boolean }[]} — `name` is the fullName vitest
 *   filters on with `-t`. `qualified` records whether that name really is the describe-qualified one:
 *   the pattern is anchored differently when only a bare title is known, because anchoring a bare
 *   title against the full name matches NOTHING (measured).
 */
export function decidingFailures(vitestJson, changedTestFiles, addedCases = null) {
  const wanted = changedTestFiles.map((f) => path.resolve(WORKSPACE_ROOT, f));
  const results = Array.isArray(vitestJson?.testResults) ? vitestJson.testResults : [];
  const out = [];
  for (const fileResult of results) {
    const name = fileResult?.name ? path.resolve(fileResult.name) : null;
    if (!name || !wanted.includes(name)) continue;
    const matchers = addedCases?.get(name) ?? null;
    for (const assertion of fileResult.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      if (matchers?.length && !matchesAddedCase(matchers, assertion)) continue;
      const title = assertion.fullName || assertion.title;
      if (title) out.push({ file: name, name: title, qualified: Boolean(assertion.fullName) });
    }
  }
  return out;
}

// ── Pure: final verdict for one qualifying pair ─────────────────────────────────────────────────────

/**
 * Decide the verdict for a single same-package pair, given the observable inputs. Kept pure so it is
 * unit-tested exhaustively without git or vitest.
 *   importsReversedFile — did any changed test relatively import a reversed source file? (C3)
 *   outcome             — classifyVitestOutcome result, or null if not run (guard tripped)
 *   witness             — did the case that supplied the red EXECUTE a line the fix changed?
 *                         (INFRA-072 direction 3.) Defaults to UNKNOWN, which changes nothing:
 *                         the instrument is evidence when it speaks and silent when it cannot.
 */
export function decidePairVerdict({ importsReversedFile, outcome, witness = WITNESS.UNKNOWN }) {
  if (!importsReversedFile) return VERDICT.INCONCLUSIVE; // C3: not in the test's module graph
  if (outcome === 'assertion-fail')
    return witness === WITNESS.UNREACHED ? VERDICT.PROOF_UNREACHED : VERDICT.RED_PROOF_OK;
  if (outcome === 'run-error') return VERDICT.INCONCLUSIVE; // C1: never a pass
  if (outcome === 'all-pass') return VERDICT.ACCIDENTAL_GREEN;
  // The range's own new case passed on the reversed source; the red came from a case that was
  // already there. That is an accidental-green regression test wearing a sibling's proof.
  if (outcome === 'added-cases-pass') return VERDICT.ACCIDENTAL_GREEN;
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

/**
 * Title matchers for the cases the range added, per deciding test file — or null when it added none
 * this can name, in which case the judgement stays at file granularity rather than failing over a
 * title it could not read.
 */
function addedCaseMatchers(testFiles, readDiffFor) {
  const byFile = new Map();
  for (const file of testFiles) {
    let matchers = [];
    try {
      matchers = addedCaseTitleMatchers(readDiffFor(file));
    } catch {
      matchers = []; // an unreadable diff means "unknown", which is file granularity
    }
    if (matchers.length > 0) byFile.set(path.resolve(WORKSPACE_ROOT, file), matchers);
  }
  return byFile.size > 0 ? byFile : null;
}

// ── Impure orchestrator ─────────────────────────────────────────────────────────────────────────────

function git(args, opts = {}) {
  return gitRaw(args, opts).trim();
}

/** Byte-exact git output. Anything fed back to git (a patch) must come through here, not `git`. */
function gitRaw(args, opts = {}) {
  return execFileSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8', ...opts });
}

function defaultDefectFixFiles(base, netChangedFiles) {
  const commits = gitRaw(['log', '--format=%H%x00%s', `${base}..HEAD`])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\0');
      const sha = line.slice(0, separator);
      const subject = line.slice(separator + 1);
      const changed = (extraArgs = []) =>
        git(['diff-tree', '--no-commit-id', '--name-only', ...extraArgs, '-r', sha])
          .split('\n')
          .filter(Boolean);
      return {
        subject,
        files: changed(),
        addedFiles: changed(['--diff-filter=A']),
      };
    });
  return filesForDefectFixCommits(commits, netChangedFiles);
}

/**
 * Reverse the range's changes to `srcPaths` — the mutation the whole gate is built around.
 *
 * The patch must be BYTE-EXACT. `git()` trims, and a patch missing its final newline is one
 * `git apply` rejects as corrupt — so every reverse-apply threw, and the gate reported nothing but
 * SKIPs and orchestration errors for its entire life (twelve CI runs, zero verdicts). Nothing
 * caught it because reaching this line requires a qualifying pair, and until INFRA-071 widened
 * `pkgOf` the subjects that produce pairs were nearly never touched by a `fix:` range.
 *
 * The seams are injected so the byte-exactness is assertable without a repository to mutate.
 */
export function defaultReverseApply(base, srcPaths, readDiff = gitRaw, exec = execFileSync) {
  const patch = readDiff(['diff', `${base}..HEAD`, '--', ...srcPaths]);
  exec('git', ['apply', '-R'], { cwd: WORKSPACE_ROOT, input: patch });
}

/**
 * INFRA-120 (issue #1905) — the base to reverse a source file TO.
 *
 * For a file that existed at `base` this is `base`, and the whole-range reversal is the right
 * mutation. For a file the range ADDED it is not: reversing to `base` DELETES the file, every case
 * importing it throws, and `classifyVitestOutcome` can then produce neither `all-pass` nor
 * `added-cases-pass` — the only two outcomes `decidePairVerdict` turns into `ACCIDENTAL_GREEN`. The
 * gate that exists to catch accidental green is structurally unable to report it for anything the
 * range introduced.
 *
 * Measured on pull request #1886, which added a scan and its test across three review rounds. A case
 * added in round two passed on the current module, on the current module with the line it guards
 * deleted, AND on the round-two predecessor that had no such support. The job emitted one verdict,
 * for a different file, and none for that pair. A human found it.
 *
 * The answer is the file's state at the commit that CREATED it: later rounds' revisions are reversed,
 * the file still exists, and its tests can run and be judged. When the range added the file and never
 * revised it there is genuinely no earlier state — `null` says so, and the caller reports that rather
 * than reversing to nothing and reading the wreckage as a verdict.
 */
export function reversalBaseFor(source, base, readLog = git) {
  const touching = readLog(['log', '--format=%H', '--reverse', `${base}..HEAD`, '--', source])
    .split('\n')
    .filter(Boolean);
  if (touching.length === 0) return base;

  const existedAtBase = (() => {
    try {
      readLog(['cat-file', '-e', `${base}:${source}`]);
      return true;
    } catch {
      return false;
    }
  })();
  if (existedAtBase) return base;

  // Added in the range. Its creating commit is the earliest state that HAS the file; anything before
  // it is the file's absence, which is what makes the reversal unreadable.
  return touching.length > 1 ? touching[0] : null;
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
  // Files ADDED in the range, so a new floor is judged even when the range is spelled `feat:`.
  const addedFiles =
    io.addedFiles ??
    git(['diff', '--name-only', '--diff-filter=A', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean);

  if (!isDefectFixRange(commitSubjects, addedFiles)) {
    log('↩︎  SKIPPED: range has no `fix:` commit and adds no floor (not a defect fix).');
    return { verdict: VERDICT.SKIPPED_NOT_FIX, decisions };
  }

  // Scope by the commit that owns each file. A mixed PR must not turn unrelated `feat:` / `perf:`
  // files into alleged defect fixes merely because another commit in the range is spelled `fix:`.
  // Synthetic fixtures provide range inputs directly and retain whole-range scope.
  const defectFixFiles =
    io.defectFixFiles ??
    (io.changedFiles !== undefined || io.commitSubjects !== undefined
      ? changedFiles
      : defaultDefectFixFiles(base, changedFiles));
  const pairs = qualifyingPairs(classifyChanges(defectFixFiles));
  if (pairs.length === 0) {
    log('↩︎  SKIPPED: no same-package (source+test) pair to red-prove.');
    return { verdict: VERDICT.SKIPPED_NO_PAIR, decisions };
  }

  const readText = io.readText ?? ((p) => fs.readFileSync(p, 'utf8'));
  const fileExists = io.fileExists ?? existsSync;
  const isDirty =
    io.isDirty ?? ((paths) => git(['status', '--porcelain', '--', ...paths]).length > 0);
  const reverseApply =
    io.reverseApply ?? ((srcPaths, from = base) => defaultReverseApply(from, srcPaths));
  const reversalBase = io.reversalBase ?? ((source) => reversalBaseFor(source, base));
  const restore = io.restore ?? ((srcPaths) => git(['checkout', '--', ...srcPaths]));
  const runVitest = io.runVitest ?? defaultRunVitest;
  const addedTestCaseDiff =
    io.addedTestCaseDiff ??
    // stderr is discarded: a range this cannot diff falls back to file granularity, and saying so
    // on the console would make every unit fixture print a git error about its synthetic base.
    ((testPath) =>
      gitRaw(['diff', `${base}..HEAD`, '--', testPath], { stdio: ['ignore', 'pipe', 'ignore'] }));

  const executionWitness = io.executionWitness ?? defaultExecutionWitness(base);

  let worst = VERDICT.RED_PROOF_OK;
  const rank = {
    [VERDICT.ACCIDENTAL_GREEN]: 4,
    // Above INCONCLUSIVE: "the red came from outside the fix" is an observation about a proof that
    // was offered, where INCONCLUSIVE is the absence of one. Below ACCIDENTAL_GREEN: a case that at
    // least fails is not yet shown to guard nothing.
    [VERDICT.PROOF_UNREACHED]: 3,
    // Beside INCONCLUSIVE rather than above it: both say the gate reached no verdict, and neither is
    // a defect in the change. It must not be BELOW `RED_PROOF_OK`, which is the omission review
    // caught — a range whose only pair has no earlier state would otherwise return the initial
    // `red-proof-ok`, and the summary would report a proof that was never attempted. That is the same
    // swallowing this change exists to stop, one level up.
    [VERDICT.NO_EARLIER_STATE]: 2,
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

    // C3 — is the reversed source actually what the changed test exercises?
    //
    // Two relations, because two kinds of source. A module is reached through the test's import
    // graph. A shell script never appears in one, so for a hook the relation is that the test
    // SPAWNS it — which is the same question asked of the thing it can be asked of. Using the
    // import graph for both would return INCONCLUSIVE for every hook, a SKIP by another name.
    const testAbs = pair.test.map((t) => path.resolve(WORKSPACE_ROOT, t));

    // ONE SOURCE AT A TIME. Reversing a pair together and judging it by one outcome meant any
    // deciding test failing read as RED_PROOF_OK for every source in the range — so a genuine proof
    // of one was reported as the proof of all, and an accidental-green sibling passed unseen. This
    // gate's own defect class, across files instead of within one, and it predated the widening that
    // made it easy to hit: a `packages/x/src` range with five sources always had it.
    //
    // Measured on `2ac10f251..b1f46acf3` — three hooks reversed together, exactly one test failing,
    // verdict `red-proof-ok`, silent about the other two.
    //
    // The cost is one vitest run per changed source instead of one per pair. That is what makes it a
    // decision rather than a patch, and it is worth it: a verdict about a set is not a verdict about
    // any member of it.
    for (const source of pair.source) {
      // Only the tests that exercise THIS source may judge it — the same relation as above, asked
      // one source at a time.
      let undeterminedRelation = false;
      const testsForSource =
        pair.pkg === HOOK_SUBJECT
          ? pair.test.filter((t, i) => {
              let text;
              try {
                text = readText(testAbs[i]);
              } catch {
                return false;
              }
              const answer = testExecutesHook(text, source);
              // A test whose spawn target could not be resolved does NOT decide. It is recorded so
              // the verdict can say it could not be tied, rather than letting a maybe-bystander
              // supply a verdict about a hook it may never have run (INFRA-074).
              if (answer === EXECUTION.UNDETERMINED) undeterminedRelation = true;
              return answer === EXECUTION.EXECUTES;
            })
          : pair.test.filter((t, i) =>
              // A module is reached through the test's import graph; a shell script never appears in
              // one, which is why the two relations differ. Asked per test and per source, so a test
              // that reaches a DIFFERENT source in the same range cannot judge this one.
              reachableRelativeGraph(
                [testAbs[i]],
                path.resolve(WORKSPACE_ROOT, pair.pkg),
                readText,
                fileExists,
              ).has(path.resolve(WORKSPACE_ROOT, source)),
            );

      const exercised = testsForSource.length > 0;
      // INFRA-072 — the range's OWN new cases are what must fail, not any case in the file.
      const addedCases = exercised ? addedCaseMatchers(testsForSource, addedTestCaseDiff) : null;
      let outcome = null;
      let witness = WITNESS.UNKNOWN;
      let runtimeMutation = true;
      // INFRA-120 — reverse to the earliest state that HAS this file, not to its absence.
      const from = exercised ? reversalBase(source) : base;
      if (exercised && from === null) {
        decisions.push({
          pkg: pair.pkg,
          source,
          verdict: VERDICT.NO_EARLIER_STATE,
          outcome: null,
          witness,
          importsReversedFile: true,
          relation: 'executed',
          runtimeMutation: true,
        });
        log(
          `⚠︎ ${source} — the range added this file and never revised it, so there is no earlier ` +
            'state to reverse to. Reversing to the base would delete it and every case would throw, ' +
            'which is not a verdict.',
        );
        // The summary must carry it too. Skipping this line is what let the top-level verdict stay at
        // its initial `red-proof-ok` for a range whose only pair could not be judged.
        if ((rank[VERDICT.NO_EARLIER_STATE] ?? 0) > (rank[worst] ?? 0))
          worst = VERDICT.NO_EARLIER_STATE;
        continue;
      }
      if (exercised) {
        let deciders = [];
        const fixedText = readText(path.resolve(WORKSPACE_ROOT, source));
        reverseApply([source], from);
        try {
          const sourceAbs = path.resolve(WORKSPACE_ROOT, source);
          const reversedText = fileExists(sourceAbs) ? readText(sourceAbs) : null;
          // Injected orchestration fixtures may model reverseApply without mutating the real tree;
          // identical text in that seam must preserve their declared test-run outcome.
          //
          // An ADDED file has no base text, and `null` used to short-circuit straight to "this is a
          // runtime mutation". That assumes a deletion always changes runtime behaviour, which is
          // false for a file that emits no runtime JS: a new TYPE-ONLY module is erased at
          // transpile, so reversing it can never fail a test, and the gate called that
          // accidental-green — a verdict its own sibling files reach as "type/comment-only change;
          // runtime red proof is not applicable". Comparing against an empty base asks the question
          // the gate actually means: does this file emit any runtime JS at all?
          runtimeMutation =
            fixedText === reversedText ||
            hasRuntimeSemanticChange(source, fixedText, reversedText ?? EMPTY_MODULE_SOURCE);
          if (runtimeMutation) {
            const vitestJson = await runVitest(pair.pkg, testsForSource);
            outcome = classifyVitestOutcome(vitestJson, testsForSource, addedCases);
            deciders = decidingFailures(vitestJson, testsForSource, addedCases);
          }
        } finally {
          restore([source]);
        }
        // INFRA-072 direction 3 — asked ONLY of an outcome being offered as a proof, and asked AFTER
        // the restore, because the question is whether the deciding case executes the code this fix
        // WROTE, and that code exists only on the restored tree. Any other outcome is already
        // settled and an instrument could only make it milder.
        if (outcome === 'assertion-fail') {
          witness = await executionWitness({ pkg: pair.pkg, source, failures: deciders });
        }
      }

      const verdict = decidePairVerdict({ importsReversedFile: exercised, outcome, witness });
      decisions.push({
        pkg: pair.pkg,
        source,
        verdict,
        outcome,
        witness,
        importsReversedFile: exercised,
        relation: exercised ? 'executed' : undeterminedRelation ? 'undetermined' : 'unrelated',
        runtimeMutation,
      });
      const icon =
        verdict === VERDICT.RED_PROOF_OK ? '✅' : verdict === VERDICT.ACCIDENTAL_GREEN ? '❌' : '⚠︎';
      const note =
        exercised && !runtimeMutation
          ? ' (type/comment-only change; runtime red proof is not applicable)'
          : !exercised && undeterminedRelation
            ? ' (no changed test could be TIED to this hook — the spawn target is built at runtime)'
            : verdict === VERDICT.PROOF_UNREACHED
              ? ' (the case that failed executed no line this fix changed)'
              : outcome
                ? ` (${outcome})`
                : '';
      log(`${icon}  ${source}: ${verdict}${note}`);
      if ((rank[verdict] ?? 0) > (rank[worst] ?? 0)) worst = verdict;
    }
  }

  return { verdict: worst, decisions };
}

/**
 * One vitest run per deciding case, and exhausting this answers UNKNOWN rather than UNREACHED
 * (see `witnessDecidingCases`).
 *
 * It was 3, paired with a comment claiming "the answer is settled by the first REACHED" — true only
 * if every deciding failure is checked, which slicing to 3 does not do.
 *
 * The size is measured, not guessed, and the measurement was worth taking: across the eight replayed
 * ranges the deciding-failure counts were 1, 1, 4, 5, 1, 10, 1, 2, 19, 3, 3, 9 — so the old cap of 3
 * truncated the walk for **5 of 12** sources. It changed no verdict there only because an early case
 * reached the fix in each; a range whose reaching case sat 4th would have been reported as a finding
 * against correct work.
 *
 * 25 covers the observed maximum of 19 with headroom. Raising it is nearly free on the healthy path:
 * a REACHED short-circuits, so a range with a sound proof pays for ONE run whatever the number is.
 * Only a range heading for a finding walks the whole list, and paying ~20 vitest runs to report a
 * correct finding instead of an UNKNOWN is the right side of that trade for an advisory gate.
 */
const WITNESS_RUN_BUDGET = 25;

/**
 * The real instrument (INFRA-072 direction 3): re-run each deciding case ALONE, on the RESTORED
 * source, and ask whether it executes the lines this fix wrote.
 *
 * On the restored tree rather than the reversed one, and against the fix's NEW side rather than its
 * old one, because that is where the fix's code exists. Measured on `c08e0dbd6`: the old-side
 * formulation called a genuine red proof `unreached`, since that fix is an ADDITION and its old side
 * held only a comment and one `case` pattern arm.
 *
 * Every deciding case is asked, in order, until one answers REACHED or the run budget stops the
 * walk — and a stopped walk answers UNKNOWN, never UNREACHED. Every failure path returns UNKNOWN
 * too: an instrument that cannot measure must not manufacture a finding.
 */
function defaultExecutionWitness(base) {
  return async ({ pkg, source, failures }) => {
    if (failures.length === 0) return WITNESS.UNKNOWN;
    let targetLines;
    try {
      targetLines = changedNewLines(
        gitRaw(['diff', `${base}..HEAD`, '--', source], { stdio: ['ignore', 'pipe', 'ignore'] }),
      ).get(source);
    } catch {
      return WITNESS.UNKNOWN; // a range this cannot diff has no target, and no target is no finding
    }
    if (!targetLines?.size) return WITNESS.UNKNOWN; // a pure deletion wrote no line to reach

    const runVitestRaw = defaultRunVitestRaw(WORKSPACE_ROOT, pkg);
    return witnessDecidingCases({
      failures,
      budget: WITNESS_RUN_BUDGET,
      witnessOne: (failure) =>
        witnessOneCase({
          workspaceRoot: WORKSPACE_ROOT,
          sourceRel: source,
          testFileAbs: failure.file,
          caseName: failure.name,
          caseNameQualified: failure.qualified !== false,
          targetLines,
          isShell: source.endsWith('.sh'),
          runVitestRaw,
        }),
    });
  };
}

function defaultRunVitest(pkg, testFiles) {
  // `--filter ./<pkg>` only resolves for a workspace package. The harness and the hooks are neither,
  // and their tests run from the repository root, so the invocation follows the subject rather than
  // assuming every subject is a package.
  const isWorkspacePackage = /^(?:packages|apps)\//.test(pkg);
  const args = isWorkspacePackage
    ? [
        '--filter',
        `./${pkg}`,
        'exec',
        'vitest',
        'run',
        '--reporter=json',
        ...testFiles.map((f) => path.relative(path.join(WORKSPACE_ROOT, pkg), f)),
      ]
    : ['exec', 'vitest', 'run', '--reporter=json', ...testFiles];
  try {
    const out = execFileSync('pnpm', args, {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

/**
 * Which verdicts BLOCK, and which merely report.
 *
 * Extracted from the CLI block so the promotion this encodes is reachable by a test. It sat inline,
 * where the one decision INFRA-046 changes could not be exercised at all — a policy nothing could
 * check, which is the shape this repository files items about.
 *
 * Exactly one verdict blocks: `accidental-green`. A test that still passes with the fix reversed
 * guards nothing, and that is a defect whatever else the run found. Every other verdict is a
 * statement about what the checker COULD NOT establish — the test never imported the reversed file,
 * the range carried no fix, vitest could not evaluate — and a conclusion never reached must not
 * refuse a merge. That asymmetry is the whole of the promotion: it blocks on a proven defect and
 * never on an absence of proof.
 */
/** Whether an orchestration CRASH may fail the job — the same switch the verdicts are judged by. */
export function enforceOnCrash(env = process.env) {
  return env['REGRESSION_RED_PROOF_ENFORCE'] === '1';
}

export function exitCodeFor(verdict, enforce) {
  if (verdict === VERDICT.ACCIDENTAL_GREEN) return enforce ? 1 : 0;
  return 0;
}

// ── CLI entry ───────────────────────────────────────────────────────────────────────────────────────

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  runRegressionRedProof()
    .then(({ verdict }) => {
      const enforce = process.env.REGRESSION_RED_PROOF_ENFORCE === '1';
      if (verdict === VERDICT.ACCIDENTAL_GREEN) {
        log(
          '\n❌ accidental-green: a regression test passes even with the fix reversed — it guards nothing.\n' +
            '   Rewrite it to FAIL on the pre-fix code, or opt out with `allow-green-at-base: <reason>`.',
        );
        process.exit(exitCodeFor(verdict, enforce));
      }
      if (verdict === VERDICT.PROOF_UNREACHED) {
        log(
          '\n⚠︎  red-proof-unreached: the case that failed on the reversed source executed no line\n' +
            '   this fix changed. Its red says the reversed tree is broken, not that the case depends\n' +
            '   on the behaviour it names. Report-only — INFRA-046 owns whether this ever blocks.',
        );
      }
      if (verdict === VERDICT.INCONCLUSIVE) {
        log('\n⚠︎  inconclusive — see decisions above (advisory).');
      }
      process.exit(0);
    })
    .catch((err) => {
      log(`\n❌ regression-red-proof: orchestration error — ${err?.message ?? err}`);
      log('   The checker did not reach a verdict. That is not a pass, and it is not a defect in');
      log(
        '   the change either — it is this tool failing, and it says so instead of exiting green.',
      );
      // Non-zero ONLY when enforcing, and the reasoning that first made this unconditional was
      // wrong in a way worth keeping: it said a red here "blocks nothing" because the job is not a
      // required check. In THIS repository that is false — `merge-gate.sh` refuses on any
      // `mergeStateStatus` other than CLEAN, and GitHub reports UNSTABLE precisely when a
      // NON-required check fails. So a transient crash would have forced every merge through the
      // manual override until someone fixed it: the untested refusal in the merge path this
      // promotion holds required-check membership specifically to avoid, arriving by another door.
      //
      // It still must not report success. A crash that exits green is indistinguishable from "ran
      // and found nothing wrong", which is the vacuity this harness spends its time removing — so
      // the failure is stated loudly above whichever way this exits.
      process.exit(exitCodeFor(VERDICT.ACCIDENTAL_GREEN, enforceOnCrash()));
    });
}
