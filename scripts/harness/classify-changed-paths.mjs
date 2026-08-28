#!/usr/bin/env node

/**
 * Changed-path classifier — THE single mechanism that decides whether a PR touches CODE and which
 * product capabilities are affected.
 *
 * ## Why this is a shared module and not two copies
 *
 * The verdict has two consumers, and they must not be able to disagree:
 *
 *  - `.github/workflows/ci.yml` › `changes` — decides whether the heavy matrix (`tui-e2e`,
 *    `examples-typecheck`, `windows-shell`, patch-coverage, regression-red-proof) runs at all.
 *  - `.github/workflows/review-gate.yml` — decides whether its same-workflow CodeQL job is
 *    applicable. A docs-only PR does not run that job, so no analysis record is written for it;
 *    without this signal the gate waits for an analysis that will
 *    never arrive and then blocks on its absence (INFRA-048's fail-closed path, misapplied — see
 *    #1436, which was blocked for a single backlog markdown file).
 *
 * If the review gate re-derived "no code changed" with its own weaker rule, that rule would be the
 * bypass: any PR that could satisfy it would skip the gate entirely. So there is exactly one
 * implementation, exported here, and both callers invoke it. A PR can only be classified docs-only
 * by the very rule that also decided to skip its build and test matrix — a code PR cannot satisfy
 * one without satisfying the other.
 *
 * ## The docs set
 *
 * `DOCS_ONLY_GLOBS` is the sole owner of docs-only applicability. CI and Review Gate consume the
 * classifier output rather than copying this list into workflow `paths-ignore` blocks.
 *
 * ## Fail-closed
 *
 * Every path that cannot determine the answer — no merge base, a failed diff, an empty file list —
 * classifies as CODE. "Nothing classified" must run the checks, not skip them (INFRA-050: a
 * `changes` job that errors makes its required dependents report `skipping`, which branch
 * protection accepts).
 *
 * Usage:
 *   node scripts/harness/classify-changed-paths.mjs --base-ref origin/develop [--head HEAD]
 *
 * Prints the merge base(s), changed files, and code/product/tui/examples booleans, and appends the
 * same values to `$GITHUB_OUTPUT` under Actions. Always exits 0 — the verdict is the output.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { appendFileSync } from 'node:fs';

/**
 * Paths that are pure documentation. Workflow callers consume this classifier; they do not own a
 * second path list.
 */
export const DOCS_ONLY_GLOBS = ['**/*.md', '**/*.mdx', 'docs/**', 'content/**'];

/** `DOCS_ONLY_GLOBS` as a matcher over repository-relative paths. */
export const DOCS_ONLY_PATTERN = /(\.mdx?$|^docs\/|^content\/)/;

/** Whether one repository-relative path is pure documentation. */
export function isDocsOnlyPath(file) {
  return DOCS_ONLY_PATTERN.test(String(file ?? ''));
}

// `.agents/` holds records, ledgers, rules and skills — the harness's own state, never product
// code; a `.jsonl` ledger append must not make a push owe 81 packages' build output (PROC-016).
const INFRASTRUCTURE_ONLY_PATTERN =
  /^(scripts\/harness\/|\.github\/|\.husky\/|\.claude\/|\.agents\/)/;

function failClosedCapabilities(reason) {
  return { code: true, product: true, tui: true, examples: true, harness: true, reason };
}

const HARNESS_OWNER_FILES = new Set([
  '.agents/harness.config.json',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'vitest.config.ts',
  'vitest.shared.ts',
]);

/** Whether one repository-relative path can change the harness implementation or its execution. */
export function isHarnessOwnerPath(file) {
  const normalized = String(file ?? '')
    .trim()
    .replaceAll('\\', '/');
  return (
    normalized.startsWith('scripts/harness/') ||
    normalized.startsWith('.github/workflows/') ||
    HARNESS_OWNER_FILES.has(normalized)
  );
}

/**
 * Classify an already-resolved list of changed paths.
 *
 * @param {string[]} files repository-relative paths changed by the PR
 * @returns {{code: boolean, reason: string}}
 */
export function classifyFiles(files) {
  const changed = (files ?? []).map((file) => String(file).trim()).filter(Boolean);
  if (changed.length === 0) {
    return failClosedCapabilities(
      'no changed files could be resolved — classifying as CODE so nothing is skipped.',
    );
  }
  const harness = changed.some(isHarnessOwnerPath);
  const codeFiles = changed.filter((file) => !isDocsOnlyPath(file));
  if (codeFiles.length === 0) {
    return {
      code: false,
      product: false,
      tui: false,
      examples: false,
      harness,
      reason: 'docs-only PR: no analyzable code changed.',
    };
  }

  const product = codeFiles.some((file) => !INFRASTRUCTURE_ONLY_PATTERN.test(file));
  return {
    code: true,
    product,
    tui: product,
    examples: product,
    harness,
    reason: product
      ? `product changes present: product matrix runs (${codeFiles.length} code file(s)).`
      : `infrastructure-only changes: product matrix is not applicable (${codeFiles.length} code file(s)).`,
  };
}

function git(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Resolve the changed paths of `head` against `baseRef` and classify them.
 *
 * The merge base is computed EXPLICITLY (not via the `...` shorthand) so it is visible in the log,
 * and over `--all` because a criss-cross history (this repo back-merges main <-> develop) can have
 * several: a file changed against ANY of them counts as changed, so an ambiguous history can only
 * over-report code, never silently under-report it.
 *
 * @returns {{code: boolean, reason: string, files: string[], bases: string[], error?: string}}
 */
export function classifyRange({ baseRef, head = 'HEAD', cwd, runGit = git } = {}) {
  const merge = runGit(['merge-base', '--all', baseRef, head], { cwd });
  const bases = merge.ok
    ? merge.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  if (bases.length === 0) {
    return {
      ...failClosedCapabilities('Classifying as CODE so no required check is silently skipped.'),
      bases: [],
      files: [],
      error: `no merge base between ${baseRef} and ${head}.`,
    };
  }

  const files = new Set();
  for (const base of bases) {
    const diff = runGit(['diff', '--name-only', '--diff-filter=ACMRD', base, head], { cwd });
    if (!diff.ok) {
      return {
        ...failClosedCapabilities('Classifying as CODE so no required check is silently skipped.'),
        bases,
        files: [],
        error: `git diff against merge base ${base} failed.`,
      };
    }
    for (const line of diff.stdout.split('\n')) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }

  const sorted = [...files].sort();
  return { ...classifyFiles(sorted), bases, files: sorted };
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv = process.argv.slice(2), write = (text) => process.stdout.write(text)) {
  const baseRef = argValue(argv, '--base-ref');
  if (!baseRef) {
    process.stderr.write(
      'usage: classify-changed-paths.mjs --base-ref <ref> [--head <rev>]\n' +
        'Classifies a PR as code vs documentation-only. Prints `code=true|false`.\n',
    );
    process.exitCode = 1;
    return undefined;
  }

  const head = argValue(argv, '--head') ?? 'HEAD';
  const result = classifyRange({ baseRef, head });

  write(`merge base(s) vs ${baseRef}:\n`);
  for (const base of result.bases) write(`  ${base}\n`);
  if (result.error) write(`::error::changes: ${result.error} ${result.reason}\n`);
  else {
    write('changed files:\n');
    for (const file of result.files) write(`  ${file}\n`);
    write(`→ ${result.reason}\n`);
  }
  write(`code=${result.code}\n`);
  write(`product=${result.product}\n`);
  write(`tui=${result.tui}\n`);
  write(`examples=${result.examples}\n`);
  write(`harness=${result.harness}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `code=${result.code}\nproduct=${result.product}\ntui=${result.tui}\nexamples=${result.examples}\nharness=${result.harness}\n`,
    );
  }
  return result;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
