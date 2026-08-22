#!/usr/bin/env node

/**
 * verify-like-ci — ONE local entry that reproduces the gate a PR must clear before it is pushed.
 *
 * WHAT IT MIRRORS: the required status checks of `protect-develop`, the ruleset a feature branch's
 * PR must satisfy. The exact stage-to-job-to-STEP map, and the two contexts that cannot be run off
 * a CI runner, live in `ci-mirror-map.mjs` and are pinned to `.github/workflows/ci.yml` and
 * `.github/required-status-checks.json` by `__tests__/ci-mirror-map.test.mjs`. A promotion to `main`
 * is a DIFFERENT gate: `protect-main`'s substantive required context is `release-grade
 * verification`, whose entry point is `pnpm harness:verify:release`.
 *
 * WHY THE BUILD AND TEST STAGES EXIST (INFRA-056). This entry was named across the rules and skills
 * as *the* CI-equivalent verification gate while running neither `pnpm build` nor any package's test
 * suite, and `harness-self-test`'s name invited reading the harness's own scan tests as package-test
 * coverage. It was found when a reviewer caught a HARNESS-049 increment replacing a skill's four
 * hardcoded verification commands — which INCLUDED the package test suite — with a pointer to this
 * entry point: a change that read as a strengthening and would have silently stopped running tests.
 * A gate that converts "I ran the CI-equivalent check" from a strong claim into a weak one without
 * anyone noticing is worse than no gate, and it is the fail-open shape INFRA-048/050 closed
 * elsewhere.
 *
 * COST. Every stage is gated on the same capability classification CI uses. Infrastructure-only
 * code still runs its harness owners but does not launch product, TUI, or examples work. The summary
 * prints measured per-stage and total times; no fixed duration claim substitutes for current evidence.
 *
 * WHY (HARNESS-045). An agent's foreground verification is typically
 * `node scripts/harness/run-all-scans.mjs`, reported as "green locally". That is NOT the same claim
 * as "green in CI": the scan suite alone omits three things CI (or the pre-commit formatter) asserts,
 * and each omission has already shipped a red PR:
 *
 *   1. The harness SELF-TEST suite (`pnpm harness:test`, run by ci.yml → `scans`). The spec-surface
 *      scan treats a below-baseline count as a PASS with a "tighten" notice, but the self-test asserts
 *      `notices == []`. A genuine SPEC improvement is therefore green in `run-all-scans` and red in
 *      CI (#1346, #1357).
 *   2. Prettier. Prettier is the repo's SSOT formatter, applied by lint-staged in `.husky/pre-commit`.
 *      A fresh worktree that pushes with `--no-verify` never runs it, so formatter-induced drift
 *      (a long single-line YAML array prettier would wrap) is neither produced nor caught locally
 *      (#1369 → HARNESS-044). No CI job re-checks formatting, so this stage is the only mechanical
 *      floor for it.
 *   3. The build-dependent scans. `check-build-output-contracts.mjs` reads each package's `dist` and
 *      silently no-ops without it; CI restores `dist` before running it (ci.yml → `quality`). Locally
 *      an unbuilt tree makes that scan a no-op that LOOKS like a pass — so a missing `dist` is a
 *      hard FAIL here with an actionable message, never a silent skip.
 *   4. The DIST-FREE half of the same suite (HARNESS-047). CI's `scans` job runs the
 *      dist-independent scans on a fresh checkout that has NO `dist/` at all, so a scan whose verdict
 *      depends on a path NOT existing sees a different tree than any built developer worktree does.
 *      `check-harness-config-paths.mjs` is exactly that shape: a hardcoded
 *      `packages/<pkg>/dist/node/index.js` literal resolves locally and is a GHOST path in CI — how
 *      HARNESS-024 (#1381) passed a full local `run-all-scans` and then failed CI. Item 3 above makes
 *      a built tree MANDATORY, so it structurally cannot reproduce this class; this stage runs the
 *      same scans against a build-output-free copy of the working tree. Both halves run; neither
 *      replaces the other.
 *
 * Every stage below is derived from the real definitions — `.github/workflows/ci.yml` and
 * `.lintstagedrc.json` — not from a hand-copied guess.
 *
 * WHERE IT IS RUN (HARNESS-058). Increasingly this is a fresh `git worktree`, because that is how
 * parallel sub-agents work, and a fresh worktree has neither `node_modules` nor `dist/`. Every stage
 * used to report that absence as a defect in the branch: `sh: 1: tsgo: not found`, a missing-module
 * stack trace, a doc-example "does not typecheck". Four agents in one day each proved those reds
 * were not their own and then pushed with `--no-verify`. So this entry point refuses to produce a
 * verdict it cannot support: `tree-prerequisites.mjs` states which prerequisite is missing and the
 * command that satisfies it. That is a FAILURE, never a skip — see `preflight`, `stageBlockCause`
 * and the build state (`initialBuildState` / `advanceBuildState`) the stage loop carries. The
 * fresh-worktree contract itself is written down in that module.
 *
 * Usage:
 *   pnpm harness:verify-like-ci
 *   pnpm harness:verify-like-ci -- --base-ref origin/main
 *   pnpm harness:verify-like-ci -- --only format-check --only harness-self-test
 *   pnpm harness:verify-like-ci -- --all-files      # format-check the whole repo, not just the diff
 *
 * Exit code 0 = every stage passed; 1 = at least one stage failed (no stage is skipped on an
 * earlier failure — a real new failure must never hide behind a known one).
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createVerificationPlan, planRequiresPackageDist } from './check-plan.mjs';
import { CI_STAGES, describeCiSource, MIRRORED_BRANCH, NOT_MIRRORED } from './ci-mirror-map.mjs';
import { classifyFiles } from './classify-changed-paths.mjs';
import {
  collectPackageManifestChanges,
  collectRootManifestChange,
  detectChangedFiles,
  listWorkspaceScopes,
  appendJobSummary,
} from './shared.mjs';
import {
  checkTreePrerequisites,
  findMissingDist as findMissingDistIn,
  formatPrerequisiteFailure,
  inspectTree,
  listBuildablePackageDirs as listBuildablePackageDirsIn,
} from './tree-prerequisites.mjs';
import { realDirtyLines, shouldWriteFullReceipt } from './verification-receipt.mjs';

export { CI_STAGES, NOT_MIRRORED };

export const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const LINT_STAGED_CONFIG = '.lintstagedrc.json';
const CI_WORKFLOW = path.join('.github', 'workflows', 'ci.yml');
const DEFAULT_BASE_REF = 'origin/develop';

// ---------------------------------------------------------------------------
// lint-staged glob → extension derivation (pure)
// ---------------------------------------------------------------------------

/** Expand one lint-staged glob key (`*.{json,md,yml,yaml}` or `*.ts`) into its extensions. */
export function globExtensions(glob) {
  const braced = /^\*\.\{([^}]+)\}$/.exec(glob);
  if (braced) return braced[1].split(',').map((ext) => `.${ext.trim()}`);
  const single = /^\*\.([A-Za-z0-9]+)$/.exec(glob);
  return single ? [`.${single[1]}`] : [];
}

/** The set of extensions lint-staged hands to prettier, derived from the parsed config object. */
export function lintStagedExtensions(config) {
  const extensions = new Set();
  for (const glob of Object.keys(config ?? {})) {
    for (const ext of globExtensions(glob)) extensions.add(ext.toLowerCase());
  }
  return [...extensions].sort();
}

/** Read `.lintstagedrc.json` from disk and derive its extension set. */
export function readLintStagedExtensions(root = WORKSPACE_ROOT) {
  const configPath = path.join(root, LINT_STAGED_CONFIG);
  if (!existsSync(configPath))
    throw new Error(`${LINT_STAGED_CONFIG} not found — cannot derive the formatter's file set.`);
  return lintStagedExtensions(JSON.parse(readFileSync(configPath, 'utf8')));
}

/** Keep only the files prettier owns, de-duplicated and ordered. */
export function selectFormatTargets(files, extensions) {
  const owned = new Set(extensions.map((ext) => ext.toLowerCase()));
  return [...new Set(files)]
    .filter((file) => file && owned.has(path.extname(file).toLowerCase()))
    .sort();
}

/** Split `git`'s newline-separated path output into a clean list. */
export function parseGitFileList(stdout) {
  return (stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// build-output (dist) presence (pure)
// ---------------------------------------------------------------------------

/**
 * Both helpers now live in `tree-prerequisites.mjs`, which is where the prerequisite question is
 * answered for every entry point. They are re-exported here with this file's workspace-root default
 * so the existing call sites and tests keep one import.
 */
export function listBuildablePackageDirs(root = WORKSPACE_ROOT) {
  return listBuildablePackageDirsIn(root);
}

export function findMissingDist(dirs, exists = existsSync, root = WORKSPACE_ROOT) {
  return findMissingDistIn(dirs, exists, root);
}

// ---------------------------------------------------------------------------
// dist-free scan mirror (pure)
// ---------------------------------------------------------------------------

/** The `pnpm harness:scan -- --skip …` invocation ci.yml's `scans` job runs on a fresh checkout. */
const CI_DIST_INDEPENDENT_SCAN_STEP =
  /pnpm\s+harness:scan\s+--\s+((?:--skip\s+[A-Za-z0-9_-]+\s*)+)/g;

/**
 * Derive the scan names ci.yml's dist-independent `scans` job skips, from the workflow text itself.
 * Hardcoding them here would re-create the very drift this entry exists to catch, so an unparseable
 * or ambiguous workflow is a loud error — never an assumed default.
 */
export function parseDistIndependentScanSkips(ciYaml) {
  const matches = [...String(ciYaml ?? '').matchAll(CI_DIST_INDEPENDENT_SCAN_STEP)];
  if (matches.length === 0)
    throw new Error(
      `no \`pnpm harness:scan -- --skip …\` step found in ${CI_WORKFLOW} — the dist-free stage cannot mirror a job it cannot read.`,
    );
  if (matches.length > 1)
    throw new Error(
      `more than one \`pnpm harness:scan -- --skip …\` step in ${CI_WORKFLOW} — ambiguous mirror target; the dist-free stage must name exactly one.`,
    );
  return [...matches[0][1].matchAll(/--skip\s+([A-Za-z0-9_-]+)/g)].map((skip) => skip[1]);
}

/** Read `.github/workflows/ci.yml` from disk and derive the dist-independent skip set. */
export function readDistIndependentScanSkips(root = WORKSPACE_ROOT) {
  const workflowPath = path.join(root, CI_WORKFLOW);
  if (!existsSync(workflowPath))
    throw new Error(`${CI_WORKFLOW} not found — cannot derive the dist-independent scan set.`);
  return parseDistIndependentScanSkips(readFileSync(workflowPath, 'utf8'));
}

/**
 * Every directory that owns an installed `node_modules`, relative to `root` (`''` = the repo root).
 * The dist-free tree is a bare `git worktree` checkout with no installs, so these are symlinked into
 * it — installing again would cost minutes for a tree that lives for seconds.
 */
export function listNodeModulesOwners(root = WORKSPACE_ROOT, maxDepth = 5) {
  const owners = [];
  const skip = new Set(['node_modules', 'dist', '.git']);
  const walk = (dir, depth) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'node_modules'))
      owners.push(path.relative(root, dir));
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return owners.sort();
}

// ---------------------------------------------------------------------------
// stage table + summary (pure)
// ---------------------------------------------------------------------------

/**
 * Render the PASS/FAIL summary and the aggregate exit code from the stage results.
 *
 * `partial` is the honest half. `--only` used to still print "PASS — all N CI-mirroring stage(s)
 * passed", so `--only format-check` produced a CI-equivalence claim from one prettier run. With
 * stages that now cost minutes, that wording is the cheapest way to hollow the gate out, so a
 * partial run says so and names what it did not run.
 */
function formatDuration(durationMs) {
  const seconds = Math.max(0, durationMs) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export function summarize(
  results,
  { skippedStages = [], notMirrored = [], totalDurationMs = null } = {},
) {
  const lines = ['', 'verify-like-ci summary:'];
  for (const result of results) {
    const mark = result.status === 'pass' ? '✓' : result.status === 'skip' ? '-' : '✗';
    const timing =
      typeof result.durationMs === 'number' ? ` [${formatDuration(result.durationMs)}]` : '';
    lines.push(`${mark} ${result.name}${timing}${result.note ? ` — ${result.note}` : ''}`);
  }
  if (typeof totalDurationMs === 'number') {
    lines.push(`total elapsed: ${formatDuration(totalDurationMs)}`);
  }
  for (const entry of notMirrored) {
    const mark = entry.relevant ? '!' : '·';
    lines.push(`${mark} ${entry.context} — NOT mirrored locally: ${entry.reason}`);
    if (entry.relevant)
      lines.push(
        `    this diff makes it relevant (${entry.relevantWhen}). Run it yourself: ${entry.manualCommand}`,
      );
  }
  const failed = results.filter((result) => result.status === 'fail');
  if (failed.length > 0) {
    lines.push(
      `FAIL — ${failed.length} of ${results.length} stage(s) failed: ${failed
        .map((result) => result.name)
        .join(', ')}`,
    );
    for (const result of failed) {
      const stage = CI_STAGES.find((entry) => entry.name === result.name);
      if (stage) lines.push(`  ${result.name} covers ${describeCiSource(stage)}`);
    }
    return { lines, exitCode: 1 };
  }
  if (skippedStages.length > 0) {
    lines.push(
      `PARTIAL — ${results.length} selected stage(s) passed. This is NOT a CI-equivalent result: ` +
        `${skippedStages.length} stage(s) were not run (${skippedStages.join(', ')}). ` +
        `Run \`pnpm harness:verify-like-ci\` with no --only before claiming the gate is green.`,
    );
    return { lines, exitCode: 0 };
  }
  lines.push(
    `PASS — all ${results.length} stage(s) passed; mirrors the required checks of \`${MIRRORED_BRANCH}\`.`,
  );
  return { lines, exitCode: 0 };
}

/** Parse the CLI arguments this entry accepts. */
export function parseArgs(argv) {
  const only = new Set();
  let baseRef = DEFAULT_BASE_REF;
  let allFiles = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) only.add(argv[++i]);
    else if (argv[i] === '--base-ref' && argv[i + 1]) baseRef = argv[++i];
    else if (argv[i] === '--all-files') allFiles = true;
  }
  const unknown = [...only].filter((name) => !CI_STAGES.some((stage) => stage.name === name));
  return { only, baseRef, allFiles, unknown };
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

function run(command, args, cwd = WORKSPACE_ROOT) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      process.stderr.write(`${error?.message ?? error}\n`);
      resolve(1);
    });
  });
}

function git(args) {
  const result = spawnSync('git', args, { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  return result.status === 0 ? parseGitFileList(result.stdout) : [];
}

/** Everything on this branch a formatter would have touched: base diff + working tree + untracked. */
export function collectChangedFiles(baseRef, gitRunner = git) {
  return [
    ...gitRunner(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`]),
    ...gitRunner(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']),
    ...gitRunner(['ls-files', '--others', '--exclude-standard']),
  ].filter((file) => existsSync(path.join(WORKSPACE_ROOT, file)));
}

async function runFormatCheck({ baseRef, allFiles }) {
  const extensions = readLintStagedExtensions();
  if (allFiles) {
    const glob = `**/*{${extensions.join(',')}}`;
    const code = await run('pnpm', ['exec', 'prettier', '--check', glob]);
    return { code, note: `whole repo, ${extensions.length} formatter-owned extension(s)` };
  }
  const targets = selectFormatTargets(collectChangedFiles(baseRef), extensions);
  if (targets.length === 0)
    return { code: 0, note: `no formatter-owned files changed vs ${baseRef}` };
  const code = await run('pnpm', ['exec', 'prettier', '--check', ...targets]);
  if (code !== 0) {
    process.stderr.write(
      `\n[format-check] Prettier is the SSOT formatter (lint-staged / .husky/pre-commit). A fresh\n` +
        `[format-check] worktree pushing with --no-verify never runs it. Fix with:\n` +
        `[format-check]   pnpm exec prettier --write ${targets.slice(0, 6).join(' ')}${
          targets.length > 6 ? ' …' : ''
        }\n`,
    );
  }
  return { code, note: `${targets.length} changed file(s) vs ${baseRef}` };
}

async function runScanSuite() {
  const missing = findMissingDist(listBuildablePackageDirs());
  if (missing.length > 0) {
    process.stderr.write(
      `\n[scan-suite] BLOCKED: ${missing.length} package(s) have no dist/ — the build-dependent scans\n` +
        `[scan-suite] (build-contracts, dist freshness) would silently no-op and LOOK like a pass.\n` +
        `[scan-suite] CI restores dist before running them (ci.yml → quality). Run:\n` +
        `[scan-suite]   pnpm build\n` +
        `[scan-suite] Missing: ${missing.slice(0, 5).join(', ')}${
          missing.length > 5 ? ` … (+${missing.length - 5})` : ''
        }\n`,
    );
    return { code: 1, note: `dist missing for ${missing.length} package(s) — run \`pnpm build\`` };
  }
  const code = await run('node', ['scripts/harness/run-all-scans.mjs']);
  return { code, note: 'full suite incl. build-contracts + dist (built tree)' };
}

/** Run a git command that MUST succeed; its failure is a stage failure, never a silent skip. */
function gitOrThrow(args, cwd = WORKSPACE_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr?.trim()}`);
  return result.stdout ?? '';
}

/**
 * Materialise the working tree WITHOUT any build output, the way CI's `scans` job sees it:
 * a detached `git worktree` of HEAD (~0.3s — no clone, no copy of dist/node_modules), plus the
 * uncommitted diff and the untracked files, plus symlinks to the existing installs. `dist/` is
 * never checked in, so it is absent by construction rather than by deletion.
 */
function createDistFreeTree(treeDir, patchFile) {
  gitOrThrow(['worktree', 'add', '--detach', treeDir, 'HEAD']);
  const patch = gitOrThrow(['diff', 'HEAD', '--binary']);
  if (patch.trim().length > 0) {
    writeFileSync(patchFile, patch);
    gitOrThrow(['apply', '--whitespace=nowarn', patchFile], treeDir);
  }
  const untracked = parseGitFileList(gitOrThrow(['ls-files', '--others', '--exclude-standard']));
  for (const file of untracked) {
    const source = path.join(WORKSPACE_ROOT, file);
    if (!existsSync(source)) continue;
    const target = path.join(treeDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const links = [];
  for (const owner of listNodeModulesOwners()) {
    const link = path.join(treeDir, owner, 'node_modules');
    if (!existsSync(path.dirname(link))) continue;
    symlinkSync(path.join(WORKSPACE_ROOT, owner, 'node_modules'), link, 'junction');
    links.push(link);
  }
  return { links, untracked: untracked.length };
}

/** Unlink the borrowed installs FIRST, so removing the tree can never reach the real node_modules. */
function destroyDistFreeTree(treeDir, links, tempRoot) {
  for (const link of links) {
    try {
      rmSync(link, { force: true });
    } catch (error) {
      process.stderr.write(
        `[scan-suite-dist-free] could not unlink ${link}: ${error?.message ?? error}\n` +
          `[scan-suite-dist-free] leaving ${tempRoot} in place — removing a tree that still borrows\n` +
          `[scan-suite-dist-free] the real node_modules is not worth the risk. Delete it by hand.\n`,
      );
      return;
    }
  }
  const removal = spawnSync('git', ['worktree', 'remove', '--force', treeDir], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  if (removal.status !== 0)
    process.stderr.write(
      `[scan-suite-dist-free] leftover worktree at ${treeDir}: ${removal.stderr?.trim()}\n` +
        `[scan-suite-dist-free] clean up with: git worktree remove --force ${treeDir}\n`,
    );
  rmSync(tempRoot, { recursive: true, force: true });
}

async function runDistFreeScanSuite() {
  const skips = readDistIndependentScanSkips();
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'verify-like-ci-dist-free-'));
  const treeDir = path.join(tempRoot, 'tree');
  let links = [];
  try {
    const prepared = createDistFreeTree(treeDir, path.join(tempRoot, 'working-tree.patch'));
    links = prepared.links;
    const args = [
      'scripts/harness/run-all-scans.mjs',
      ...skips.flatMap((skip) => ['--skip', skip]),
    ];
    const code = await run('node', args, treeDir);
    if (code !== 0)
      process.stderr.write(
        `\n[scan-suite-dist-free] These scans ran on a build-output-FREE copy of this branch — the\n` +
          `[scan-suite-dist-free] tree CI's \`scans\` job checks out. A finding here that passes the\n` +
          `[scan-suite-dist-free] built-tree stage means the code depends on dist/ existing (e.g. a\n` +
          `[scan-suite-dist-free] hardcoded build-output path literal), and CI will fail on it.\n`,
      );
    return { code, note: `dist-free worktree of HEAD+changes, skips: ${skips.join(', ')}` };
  } catch (error) {
    process.stderr.write(`\n[scan-suite-dist-free] ${error?.message ?? error}\n`);
    return { code: 1, note: 'could not materialise the dist-free tree' };
  } finally {
    destroyDistFreeTree(treeDir, links, tempRoot);
  }
}

// ---------------------------------------------------------------------------
// the new CI-parity stages (INFRA-056)
// ---------------------------------------------------------------------------

/**
 * The commits this branch itself authored, first-parent, exactly as ci.yml's commitlint job
 * computes them. `--first-parent` drops history the branch merged IN, which belongs to the PRs that
 * introduced it; ci.yml documents this shell loop as its own local equivalent.
 */
export function firstParentCommits(baseRef) {
  // Not the tolerant `git()` helper: an unresolvable base must be a loud failure, never an empty
  // list that reads as "this branch authored no commits" and lints nothing.
  return parseGitFileList(gitOrThrow(['rev-list', '--first-parent', `${baseRef}..HEAD`]));
}

async function runCommitlint({ baseRef }) {
  const commits = firstParentCommits(baseRef);
  if (commits.length === 0) return { code: 0, note: `no commits authored vs ${baseRef}` };
  for (const sha of commits) {
    const message = spawnSync('git', ['log', '-1', '--format=%B', sha], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    const lint = spawnSync('pnpm', ['exec', 'commitlint', '--verbose'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      input: message.stdout ?? '',
    });
    if (lint.status !== 0) {
      process.stderr.write(
        `\n[commitlint] ${sha.slice(0, 9)} ${(message.stdout ?? '').split('\n')[0]}\n` +
          `${lint.stdout ?? ''}${lint.stderr ?? ''}\n`,
      );
      return { code: 1, note: `${sha.slice(0, 9)} fails the conventional-commit rules` };
    }
  }
  return { code: 0, note: `${commits.length} commit(s) vs ${baseRef}` };
}

async function runBuild(_options, context) {
  const code = await run('pnpm', ['build']);
  return { code, note: context.buildReason };
}

/** The affected scopes, named in the stage note so "it ran nothing" is never invisible. */
export function describeAffectedScopes(context) {
  const scopes = (context?.plan?.scopes ?? []).map((scope) => scope.scope);
  return scopes.length === 0
    ? 'no package/app scope affected — CI verifies none either'
    : `${scopes.length} affected scope(s): ${scopes.slice(0, 4).join(', ')}${scopes.length > 4 ? ' …' : ''}`;
}

async function runAffectedVerify({ baseRef }, context) {
  const code = await run('pnpm', [
    'harness:verify',
    '--',
    '--base-ref',
    baseRef,
    '--skip-build',
    '--skip-record-check',
    '--skip-repository-check',
    'harness-tests',
    '--skip-typecheck',
  ]);
  return { code, note: describeAffectedScopes(context) };
}

const STAGE_RUNNERS = {
  'format-check': runFormatCheck,
  commitlint: runCommitlint,
  'harness-self-test': async () => ({ code: await run('pnpm', ['harness:test:contracts']) }),
  'harness-hermetic-test': async () => ({ code: await run('pnpm', ['harness:test:hermetic']) }),
  'scan-suite-dist-free': runDistFreeScanSuite,
  typecheck: async () => ({ code: await run('pnpm', ['-w', 'typecheck']) }),
  build: runBuild,
  'scan-suite': runScanSuite,
  'affected-verify': runAffectedVerify,
  'binary-e2e': async () => ({
    code: await run('pnpm', ['--filter', '@robota-sdk/agent-cli', 'test:bin']),
  }),
  'examples-typecheck': async () => ({ code: await run('pnpm', ['examples:typecheck']) }),
  'tui-e2e': async () => ({
    code: await run('pnpm', ['--filter', '@robota-sdk/agent-transport-tui', 'test:pty']),
  }),
};

// ---------------------------------------------------------------------------
// run context + stage gates
// ---------------------------------------------------------------------------

/**
 * Everything the stage gates are decided from, computed ONCE from the same inputs CI uses: the
 * verification plan (`createVerificationPlan`, the function `harness:plan` calls), the code/docs
 * classifier (`classifyFiles`, the function ci.yml's `changes` job calls) and the on-disk dist.
 *
 * Nothing here re-derives a CI condition with a local copy of the rule. `classify-changed-paths`
 * states why: a second, weaker copy of "no build needed" IS the bypass.
 */
export async function resolveRunContext(baseRef) {
  const changedFiles = detectChangedFiles(baseRef);
  const scopes = await listWorkspaceScopes();
  const manifestChangesByScope = await collectPackageManifestChanges({
    scopes,
    changedFiles,
    baseRef,
  });
  const rootManifestChange = await collectRootManifestChange({ changedFiles, baseRef });
  const plan = createVerificationPlan({
    scopes,
    changedFiles,
    scopeTokens: [],
    manifestChangesByScope,
    rootManifestChange,
    includeDependentScopes: true,
  });
  const missingDist = findMissingDist(listBuildablePackageDirs());
  const distRequired = planRequiresPackageDist(plan);
  const changeClassification = classifyFiles(changedFiles);
  const codeChanged = changeClassification.code;
  const productChanged = changeClassification.product;
  const tuiChanged = changeClassification.tui;
  const examplesChanged = changeClassification.examples;
  const harnessChanged = changeClassification.harness;
  return {
    changedFiles,
    plan,
    distRequired,
    codeChanged,
    productChanged,
    tuiChanged,
    examplesChanged,
    harnessChanged,
    missingDist,
    buildReason: describeBuildReason({ distRequired, productChanged, missingDist }),
  };
}

function describeBuildReason({ distRequired, productChanged, missingDist }) {
  if (distRequired) return 'the plan needs build output (ci.yml → build builds too)';
  if (missingDist.length > 0)
    return `${missingDist.length} package(s) have no dist/ — the dist-dependent scans would silently no-op`;
  if (productChanged)
    return 'code changed — ci.yml builds inside tui-e2e / examples-typecheck regardless of the plan';
  return 'skipped';
}

/**
 * The prerequisite gate for this entry point (HARNESS-058).
 *
 * Only `install` is demanded up front. `build-output` deliberately is NOT: the `build` stage
 * produces it, and demanding it here would tell an agent to run by hand the very command the gate
 * is about to run. What must never happen is a stage reporting a verdict on ground the tree could
 * not provide — `blockedByMissingBuildOutput` covers the runs where `build` will not fill the gap.
 */
export function preflight(root = WORKSPACE_ROOT) {
  return checkTreePrerequisites('verify-like-ci', root, ['install']);
}

/** Build output present on disk RIGHT NOW, re-read rather than remembered. */
function readMissingDistNow() {
  return findMissingDist(listBuildablePackageDirs());
}

/**
 * The build-output state a run carries THROUGH its stage loop — state, not a flag computed once.
 *
 * The first version of this precomputed `willBuild` from whether the `build` stage would be
 * ATTEMPTED and never updated it, which is a different claim from "build output exists". Measured on
 * a fresh worktree with a real build regression: `pnpm build` failed, every consuming stage still
 * ran, and they reported the unbuilt tree as a defect in the change —
 * `TS2307: Cannot find module '@robota-sdk/agent-framework'` plus a spurious "install @types/node"
 * hint from `examples-typecheck`, and 20s of `serve host did not come up` from `binary-e2e`. That is
 * the exact noise this entry point exists to remove, arriving in the one scenario the feature is for.
 */
export function initialBuildState(selected, context) {
  const buildRuns =
    selected.some((stage) => stage.name === 'build') && stageGate('build', context).run;
  return { buildPending: buildRuns, buildFailed: false, missingDist: context.missingDist };
}

/**
 * The state after a stage ran. Only `build` moves it, and it moves by RE-READING dist from disk: a
 * build that failed leaves the tree exactly as unbuilt as it found it.
 */
export function advanceBuildState(state, stage, code, readMissingDist = readMissingDistNow) {
  if (stage.name !== 'build') return state;
  return { buildPending: false, buildFailed: code !== 0, missingDist: readMissingDist() };
}

/**
 * Why a stage cannot be trusted to report on the CHANGE, or null when it can.
 *
 * Never a way to pass: a blocked stage still FAILS. What it changes is the message — which
 * prerequisite is missing, or which earlier failure caused it — instead of a module-resolution
 * error that reads like a broken import in the diff.
 */
export function stageBlockCause(stage, state) {
  if (!stage?.needsBuildOutput) return null;
  if (state.buildPending || state.missingDist.length === 0) return null;
  return state.buildFailed ? 'build-failed' : 'unprepared';
}

/**
 * Whether a stage runs, and why not when it does not.
 *
 * A stage skips only where CI's own job would be skipped or would do nothing, so a skip never
 * weakens the PASS line. The `build` gate is deliberately WIDER than ci.yml's `build` job condition:
 * `tui-e2e` and `examples-typecheck` each run `pnpm build:deps` inside their own job and never
 * consume the `build` artifact, and `scan-suite` hard-fails on absent dist — three dist consumers
 * the plan predicate alone does not see. Without the widening, a `scripts/harness` branch would skip
 * the build and then drive whatever stale binary happened to be in the worktree.
 */
export function stageGate(name, context) {
  switch (name) {
    case 'harness-hermetic-test':
      return context.harnessChanged !== false
        ? { run: true }
        : {
            run: false,
            note: 'harness capability is not affected — CI skips only the hermetic tier',
          };
    case 'build':
      return context.distRequired || context.productChanged || context.missingDist.length > 0
        ? { run: true }
        : {
            run: false,
            note: 'no scope needs build output and dist is present — ci.yml → build skips too',
          };
    case 'binary-e2e':
      return context.distRequired
        ? { run: true }
        : {
            run: false,
            note: 'ci.yml gates it on `package_dist_required`, which this plan is not',
          };
    case 'examples-typecheck':
      return context.examplesChanged
        ? { run: true }
        : { run: false, note: 'examples capability is not affected — CI reports N/A' };
    case 'tui-e2e':
      return context.tuiChanged
        ? { run: true }
        : { run: false, note: 'TUI capability is not affected — CI reports N/A' };
    default:
      return { run: true };
  }
}

/** The un-mirrorable contexts, marked relevant when this diff makes them matter. */
export function annotateNotMirrored(
  changedFiles,
  productChanged = classifyFiles(changedFiles).product,
) {
  const touchesManifest = changedFiles.some(
    (file) =>
      file === 'pnpm-lock.yaml' || file === 'package.json' || file.endsWith('/package.json'),
  );
  const evaluate = (key) => {
    if (key === 'manifest-or-lockfile') return touchesManifest;
    if (key === 'code') return productChanged;
    // A workflow edit is not `code` — the `changes` classifier reports infrastructure-only work as
    // N/A — so `workflow provenance` would have been marked irrelevant on exactly the diffs it
    // exists to judge. Its own subject is the file list, so its relevance is a file-list question.
    //
    // A DIRECTORY test, not a registry lookup, and the imprecision is deliberate. Asking
    // `readGuardedWorkflows()` which files actually provide a required context is more precise, and
    // it was tried: it makes relevance depend on a file THE CHANGE CAN EDIT. A change that edits a
    // workflow and drops its context from the registry in the same commit would compute its own
    // relevance as false — which is the shape `workflow-provenance-gate` exists to refuse,
    // reproduced inside the relevance calculation. The gate reads the registry from the BASE for
    // exactly this reason; `annotateNotMirrored` runs locally against the working tree and has no
    // base to read from.
    //
    // The imprecision costs one advisory line on a diff already touching CI, where someone is
    // already looking. Under-reporting hides a required check nobody will run by hand. If the noise
    // ever matters, the fix is to read the registry from the merge base — which needs a base ref
    // this function does not take.
    if (key === 'guarded-workflow')
      return changedFiles.some((file) => file.startsWith('.github/workflows/'));
    // An unknown key must SHOUT rather than be ignored: the alternative is a required check
    // quietly demoted to a footnote by a relevance rule nobody implemented.
    return true;
  };
  return NOT_MIRRORED.map((entry) => ({ ...entry, relevant: evaluate(entry.relevance) }));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.unknown.length > 0) {
    process.stderr.write(`unknown --only stage(s): ${options.unknown.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const selected = CI_STAGES.filter(
    (stage) => options.only.size === 0 || options.only.has(stage.name),
  );
  const skippedStages = CI_STAGES.filter((stage) => !selected.includes(stage)).map(
    (stage) => stage.name,
  );

  // Before anything is measured: a tree that was never installed cannot produce a verdict on a
  // change, and every stage's failure would be about the tree instead (HARNESS-058).
  const prerequisites = preflight();
  if (!prerequisites.ok) {
    process.stderr.write(prerequisites.message);
    process.exitCode = 1;
    return;
  }

  let context;
  try {
    context = await resolveRunContext(options.baseRef);
  } catch (error) {
    process.stderr.write(
      `\nverify-like-ci could not resolve what this branch changes: ${error?.message ?? error}\n` +
        `Every stage gate is derived from that, so running a subset would report a pass over ground\n` +
        `it never measured. Fix the base ref (\`--base-ref <ref>\`, or fetch the base branch) and re-run.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `\nmirroring the required checks of \`${MIRRORED_BRANCH}\` — ${context.changedFiles.length} changed file(s) vs ${options.baseRef}, ` +
      `${context.codeChanged ? 'CODE' : 'docs-only'}, ${context.distRequired ? 'build output required' : 'no build output required'}\n`,
  );

  let buildState = initialBuildState(selected, context);

  const results = [];
  const runStartedAt = performance.now();
  for (const stage of selected) {
    const stageStartedAt = performance.now();
    // The gate is asked FIRST: a stage CI would not run at all needs no prerequisite, and reporting
    // one for it would invent a failure where a skip is the honest answer.
    const gate = stageGate(stage.name, context);
    if (!gate.run) {
      process.stdout.write(`\n===== ${stage.name} (skipped) =====\n${gate.note}\n`);
      results.push({
        name: stage.name,
        status: 'skip',
        note: gate.note,
        durationMs: performance.now() - stageStartedAt,
      });
      continue;
    }
    const blocked = stageBlockCause(stage, buildState);
    if (blocked) {
      process.stdout.write(`\n===== ${stage.name} =====\n`);
      process.stderr.write(
        formatPrerequisiteFailure(
          `verify-like-ci stage \`${stage.name}\``,
          inspectTree(WORKSPACE_ROOT, ['build-output']),
          blocked,
        ),
      );
      results.push({
        name: stage.name,
        status: 'fail',
        durationMs: performance.now() - stageStartedAt,
        note:
          blocked === 'build-failed'
            ? '`build` failed in this run — this stage measured nothing'
            : 'unbuilt tree — this stage measured nothing; run `pnpm build`',
      });
      continue;
    }
    process.stdout.write(`\n===== ${stage.name} =====\nmirrors: ${describeCiSource(stage)}\n`);
    const outcome = await STAGE_RUNNERS[stage.name](options, context);
    results.push({
      name: stage.name,
      status: outcome.code === 0 ? 'pass' : 'fail',
      note: outcome.note,
      durationMs: performance.now() - stageStartedAt,
    });
    buildState = advanceBuildState(buildState, stage, outcome.code);
  }
  const { lines, exitCode } = summarize(results, {
    skippedStages,
    notMirrored: annotateNotMirrored(context.changedFiles, context.productChanged),
    totalDurationMs: performance.now() - runStartedAt,
  });
  process.stdout.write(`${lines.join('\n')}\n`);
  appendJobSummary(`${lines.join('\n')}\n`);
  let finalExitCode = exitCode;
  let clean = false;
  let dirty = [];
  try {
    dirty = realDirtyLines(WORKSPACE_ROOT);
    clean = dirty.length === 0;
  } catch (error) {
    process.stderr.write(`verification receipt eligibility failed: ${error?.message ?? error}\n`);
  }
  if (
    shouldWriteFullReceipt({
      exitCode,
      clean,
      selectedStages: selected.map((stage) => stage.name),
      requiredStages: CI_STAGES.map((stage) => stage.name),
    })
  ) {
    const receiptCode = await run('scripts/harness/with-repo-lock.sh', [
      process.execPath,
      'scripts/harness/verification-receipt.mjs',
      '--base-ref',
      options.baseRef,
      ...selected.flatMap((stage) => ['--stage', stage.name]),
    ]);
    if (receiptCode !== 0) finalExitCode = 1;
  } else if (exitCode === 0) {
    // Name the reason. A green run that quietly produced no receipt is why every push kept paying the
    // full gate (INFRA-101) — "run was partial or tree was not clean" told the operator neither which
    // of the two it was nor what to do about it.
    const missing = CI_STAGES.map((stage) => stage.name).filter(
      (name) => !selected.some((stage) => stage.name === name),
    );
    const reasons = [];
    if (missing.length > 0)
      reasons.push(`partial run — stage(s) not selected: ${missing.join(', ')}`);
    if (!clean) reasons.push(`working tree is not clean: ${dirty.join(', ')}`);
    process.stdout.write(
      `verification receipt not written: ${reasons.join('; ') || 'eligibility check failed'}\n` +
        '  (without a receipt the next `git push` re-runs this entire gate)\n',
    );
  }
  process.exitCode = finalExitCode;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
