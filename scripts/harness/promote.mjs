#!/usr/bin/env node

/**
 * Build the `develop -> main` promotion branch (INFRA-051).
 *
 * The promotion used to be assembled by hand, and every cycle a human had to RE-DERIVE the same
 * per-dependency conflict resolution — on five `package.json` files plus `pnpm-lock.yaml` — because
 * the previous sync had been squashed and recorded no ancestry. Neither wholesale direction was
 * safe: `--theirs` toward `main` reverts develop's dependency patch bumps, `--theirs` toward
 * `develop` un-archives backlog items and drops changesets. This script removes the derivation.
 *
 * The construction is fixed and produces no conflicts in the steady state:
 *
 *     git checkout -B release/promote-develop-to-main origin/develop
 *     git merge --no-ff origin/main
 *
 * `main`'s side of that three-way merge is EMPTY — `merge-base(develop, main)` is the develop commit
 * the last promotion promoted, and `main`'s tree equals that commit's tree — so there is nothing to
 * resolve. When `main` HAS drifted (a `hotfix/*` landed on it, someone pushed directly), the merge
 * is not clean and the script stops: that is real divergence, and it must be back-merged into
 * `develop` deliberately rather than resolved inside a promotion.
 *
 * The same A1/A2/A3 assertions the CI gate runs are checked here, so the branch is known-good before
 * the PR exists.
 *
 * Usage:
 *   node scripts/harness/promote.mjs [--branch <name>] [--dry-run]
 *
 * It does NOT open the PR and does NOT merge: promoting to `main` is a release-level action that
 * requires explicit user approval (`.agents/rules/git-branch.md`). It prints the exact next commands.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { evaluatePromotion, runGit } from './scan-promotion-ancestry.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_BRANCH = 'release/promote-develop-to-main';

function git(args) {
  return runGit(args, WORKSPACE_ROOT);
}

function must(args, what) {
  const result = git(args);
  if (result.code !== 0) {
    process.stdout.write(`promote: ${what} failed:\n${result.stderr || result.stdout}\n`);
    process.exit(1);
  }
  return result.stdout;
}

function flag(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const branch = flag(argv, '--branch', DEFAULT_BRANCH);
  const dryRun = argv.includes('--dry-run');

  const dirty = must(['status', '--porcelain'], 'reading the working tree');
  if (dirty.length > 0) {
    process.stdout.write(
      'promote: the working tree is not clean. A promotion branch must be cut from a clean tree so\n' +
        'the promoted content is exactly what `develop` integrated.\n',
    );
    process.exit(1);
  }

  process.stdout.write('promote: fetching origin…\n');
  must(['fetch', 'origin', '--prune'], 'git fetch');

  const developSha = must(['rev-parse', 'origin/develop'], 'resolving origin/develop');
  const mainSha = must(['rev-parse', 'origin/main'], 'resolving origin/main');
  process.stdout.write(
    `promote: origin/develop ${developSha.slice(0, 9)} → origin/main ${mainSha.slice(0, 9)}\n`,
  );

  if (git(['merge-base', '--is-ancestor', 'origin/develop', 'origin/main']).code === 0) {
    process.stdout.write(
      'promote: origin/main already contains origin/develop — nothing to promote.\n',
    );
    return;
  }

  // Dry-run the merge as a pure object operation first, so a drifted `main` is reported BEFORE any
  // branch is created or the working tree is touched.
  const mergeTree = spawnSync(
    'git',
    ['merge-tree', '--write-tree', 'origin/develop', 'origin/main'],
    {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    },
  );
  if ((mergeTree.status ?? 1) !== 0) {
    process.stdout.write(
      'promote: merging `origin/main` into the promotion branch CONFLICTS.\n\n' +
        (mergeTree.stdout ?? '') +
        '\nThat means `main` carries content `develop` has never integrated — a `hotfix/*`, a direct\n' +
        'push, or a conflict-resolving merge. Do NOT resolve it inside the promotion: back-merge\n' +
        '`main` into `develop` on its own PR (merged as a MERGE COMMIT, never a squash), then re-run\n' +
        'this script. Resolving here is exactly the hand-derived resolution INFRA-051 removed.\n',
    );
    process.exit(1);
  }
  const mergedTree = mergeTree.stdout.trim().split('\n')[0];
  const developTree = must(['rev-parse', 'origin/develop^{tree}'], 'resolving develop tree');
  if (mergedTree !== developTree) {
    process.stdout.write(
      "promote: merging `origin/main` changes develop's tree, so `main` holds content `develop`\n" +
        'lacks. Back-merge `main` into `develop` first (merge commit, never a squash), then re-run.\n',
    );
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write(
      `promote: --dry-run — the merge is clean and promotes develop's tree unchanged (${mergedTree.slice(0, 9)}).\n`,
    );
    return;
  }

  process.stdout.write(`promote: creating ${branch} from origin/develop…\n`);
  must(['checkout', '-B', branch, 'origin/develop'], `creating ${branch}`);
  const merge = git([
    'merge',
    '--no-ff',
    'origin/main',
    '-m',
    "chore(release): record main's ancestry into the promotion",
  ]);
  if (merge.code !== 0) {
    process.stdout.write(
      `promote: git merge failed unexpectedly:\n${merge.stderr || merge.stdout}\n`,
    );
    process.exit(1);
  }

  const head = must(['rev-parse', 'HEAD'], 'resolving the promotion head');
  const { findings, baselineDebt } = evaluatePromotion({ git, head });
  if (findings.length > 0) {
    process.stdout.write(
      'promote: the promotion branch does NOT satisfy the promotion-ancestry gate:\n',
    );
    for (const finding of findings) process.stdout.write(`  - [${finding.id}] ${finding.detail}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `\npromote: ${branch} is ready — A1/A2/A3 hold (pre-adoption baseline debt on main: ${baselineDebt}).\n` +
      `\nNext (promoting to \`main\` is a release-level action needing explicit user approval):\n` +
      `  git push -u origin ${branch}\n` +
      `  gh pr create --base main --head ${branch} --title "chore(release): promote develop to main"\n` +
      `  gh pr merge <n> --merge          # NEVER --squash; \`protect-main\` now rejects it outright\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
