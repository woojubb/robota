#!/usr/bin/env node

/**
 * verify-like-ci — ONE local entry that reproduces the gate a PR must clear before it is pushed.
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
 *
 * Every stage below is derived from the real definitions — `.github/workflows/ci.yml` and
 * `.lintstagedrc.json` — not from a hand-copied guess.
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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const LINT_STAGED_CONFIG = '.lintstagedrc.json';
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
 * Workspace dirs that produce build output — a package whose manifest declares `build:js`
 * (the script the root `pnpm build` fans out to). Mirrors the `packages/*` +
 * `packages/dag-nodes/*` set ci.yml archives as `package-dist.tgz`.
 */
export function listBuildablePackageDirs(root = WORKSPACE_ROOT) {
  const roots = [path.join(root, 'packages'), path.join(root, 'packages', 'dag-nodes')];
  const dirs = [];
  for (const base of roots) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const manifest = path.join(base, entry.name, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg?.scripts?.['build:js']) dirs.push(path.relative(root, path.join(base, entry.name)));
    }
  }
  return dirs.sort();
}

/** Buildable dirs with no `dist/` — CI restores these before the dist-dependent scans run. */
export function findMissingDist(dirs, exists = existsSync, root = WORKSPACE_ROOT) {
  return dirs.filter((dir) => !exists(path.join(root, dir, 'dist')));
}

// ---------------------------------------------------------------------------
// stage table + summary (pure)
// ---------------------------------------------------------------------------

/**
 * The CI-mirroring stage table. `ciSource` names the real definition each stage reproduces, so a
 * drift in ci.yml is traceable to the stage that must follow it.
 */
export const CI_STAGES = [
  {
    name: 'harness-self-test',
    ciSource: 'ci.yml → scans → "Harness scan test suite" (pnpm harness:test)',
    why: 'asserts baseline TIGHTNESS (spec-surface notices == []), which run-all-scans reports as a pass',
  },
  {
    name: 'format-check',
    ciSource: '.lintstagedrc.json (prettier via .husky/pre-commit)',
    why: 'a --no-verify push from a fresh worktree never runs the SSOT formatter',
  },
  {
    name: 'scan-suite',
    ciSource:
      'ci.yml → scans "Harness scan suite" + quality "Build-output contracts scan" (built dist)',
    why: 'the dist-dependent scans silently no-op on an unbuilt tree',
  },
  {
    name: 'typecheck',
    ciSource: 'ci.yml → quality → harness:verify (typecheck step)',
    why: 'CI typechecks every affected scope; the scan suite never typechecks',
  },
];

/** Render the PASS/FAIL summary and the aggregate exit code from the stage results. */
export function summarize(results) {
  const lines = ['', 'verify-like-ci summary:'];
  for (const result of results) {
    const mark = result.status === 'pass' ? '✓' : result.status === 'skip' ? '-' : '✗';
    lines.push(`${mark} ${result.name}${result.note ? ` — ${result.note}` : ''}`);
  }
  const failed = results.filter((result) => result.status === 'fail');
  if (failed.length === 0) {
    lines.push(`PASS — all ${results.length} CI-mirroring stage(s) passed.`);
    return { lines, exitCode: 0 };
  }
  lines.push(
    `FAIL — ${failed.length} of ${results.length} stage(s) failed: ${failed
      .map((result) => result.name)
      .join(', ')}`,
  );
  for (const result of failed) {
    const stage = CI_STAGES.find((entry) => entry.name === result.name);
    if (stage) lines.push(`  ${result.name} mirrors ${stage.ciSource}`);
  }
  return { lines, exitCode: 1 };
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

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: WORKSPACE_ROOT, stdio: 'inherit', shell: false });
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

const STAGE_RUNNERS = {
  'harness-self-test': async () => ({ code: await run('pnpm', ['harness:test']) }),
  'format-check': runFormatCheck,
  'scan-suite': runScanSuite,
  typecheck: async () => ({ code: await run('pnpm', ['-w', 'typecheck']) }),
};

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
  const results = [];
  for (const stage of selected) {
    process.stdout.write(`\n===== ${stage.name} =====\nmirrors: ${stage.ciSource}\n`);
    const outcome = await STAGE_RUNNERS[stage.name](options);
    results.push({
      name: stage.name,
      status: outcome.code === 0 ? 'pass' : 'fail',
      note: outcome.note,
    });
  }
  const { lines, exitCode } = summarize(results);
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
