#!/usr/bin/env node

/**
 * Single fail-closed owner for changed-path and capability classification. Both CI and Review Gate
 * consume this verdict so documentation detection cannot diverge between required checks.
 *
 * Usage: node scripts/harness/classify-changed-paths.mjs --base-ref origin/develop [--head HEAD]
 * The CLI prints classifications and mirrors them to `$GITHUB_OUTPUT` under Actions.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { appendFileSync } from 'node:fs';

import { resolveCapabilityReachability } from './changed-path-capabilities.mjs';
import { classifyRootManifestChange } from './shared.mjs';

export { resolveCapabilityReachability } from './changed-path-capabilities.mjs';

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
  /^(scripts\/harness\/|scripts\/build-|\.github\/|\.husky\/|\.claude\/|\.agents\/)/;

function failClosedCapabilities(reason) {
  return {
    code: true,
    product: true,
    tui: true,
    examples: true,
    windows: true,
    cli: true,
    harness: true,
    full: true,
    reason,
  };
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
    normalized.startsWith('scripts/build-') ||
    normalized.startsWith('.github/workflows/') ||
    HARNESS_OWNER_FILES.has(normalized)
  );
}

const WORKSPACE_FULL_FILES = new Set([
  '.eslintignore',
  '.eslintrc.json',
  '.npmrc',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.eslint.json',
  'tsconfig.json',
  'vitest.config.ts',
  'vitest.shared.ts',
]);

/** Inputs that can change product ownership, graph traversal, or root product configuration. */
export function isFullVerificationPath(file, { rootManifestChange = null } = {}) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  if (normalized === 'package.json') return rootManifestChange?.workspaceWide !== false;
  return WORKSPACE_FULL_FILES.has(normalized) || /(^|\/)package\.json$/u.test(normalized);
}

/**
 * Classify an already-resolved list of changed paths.
 *
 * @param {string[]} files repository-relative paths changed by the PR
 * @returns {{code: boolean, reason: string}}
 */
export function classifyFiles(files, { rootManifestChange = null, capabilities = null } = {}) {
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
      windows: false,
      cli: false,
      harness,
      full: false,
      reason: 'docs-only PR: no analyzable code changed.',
    };
  }

  const full =
    codeFiles.some((file) => isFullVerificationPath(file, { rootManifestChange })) ||
    Boolean(capabilities?.error);

  const product = codeFiles.some((file) => {
    if (INFRASTRUCTURE_ONLY_PATTERN.test(file)) return false;
    if (file === 'package.json' && rootManifestChange?.workspaceWide === false) return false;
    return true;
  });
  return {
    code: true,
    product,
    tui: full || capabilities?.tui === true,
    examples: full || capabilities?.examples === true,
    windows: full || capabilities?.windows === true,
    cli: full || capabilities?.cli === true,
    harness,
    full,
    reason: capabilities?.error
      ? `${capabilities.error}; full verification runs fail closed.`
      : full
        ? 'control-plane, workspace graph, manifest, lock, or root config changed: full verification runs.'
        : product
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

function classifyRootManifestFromGit({ files, bases, head, cwd, runGit }) {
  if (!files.includes('package.json')) return null;
  const headManifest = runGit(['show', `${head}:package.json`], { cwd });
  if (!headManifest.ok) return null;
  try {
    const after = JSON.parse(headManifest.stdout);
    for (const base of bases) {
      const baseManifest = runGit(['show', `${base}:package.json`], { cwd });
      if (!baseManifest.ok) return null;
      const classification = classifyRootManifestChange({
        before: JSON.parse(baseManifest.stdout),
        after,
      });
      if (classification.changedKeys.length === 1 && classification.changedKeys[0] === 'scripts') {
        continue;
      }
      if (classification.workspaceWide !== false) return classification;
    }
    return { kind: 'developer-quality-only', workspaceWide: false };
  } catch {
    return null;
  }
}

/** Resolve changes against every merge base and fail closed on unresolved history. */
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
  const rootManifestChange = classifyRootManifestFromGit({
    files: sorted,
    bases,
    head,
    cwd,
    runGit,
  });
  const capabilities = sorted.some((file) => isFullVerificationPath(file, { rootManifestChange }))
    ? null
    : resolveCapabilityReachability(sorted, { cwd: cwd ?? process.cwd() });
  return { ...classifyFiles(sorted, { rootManifestChange, capabilities }), bases, files: sorted };
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
  write(`windows=${result.windows}\n`);
  write(`cli=${result.cli}\n`);
  write(`harness=${result.harness}\n`);
  write(`full=${result.full}\n`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `code=${result.code}\nproduct=${result.product}\ntui=${result.tui}\nexamples=${result.examples}\nwindows=${result.windows}\ncli=${result.cli}\nharness=${result.harness}\nfull=${result.full}\n`,
    );
  }
  return result;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
