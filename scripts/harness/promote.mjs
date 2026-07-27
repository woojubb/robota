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

import { ADOPTION_BASELINE, evaluatePromotion, runGit } from './scan-promotion-ancestry.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
export const DEFAULT_BRANCH = 'release/promote-develop-to-main';

/** Thrown for a handled, explained failure. `main()` turns it into a non-zero exit code. */
class PromoteError extends Error {}

function flag(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  return argv[index + 1] ?? fallback;
}

/**
 * Build the promotion branch. Every dependency is injected (`cwd` selects the repository, `out`
 * receives the report) so this is drivable against a throwaway repo — the script `git-branch.md`
 * mandates as the only sanctioned promotion path must itself be tested.
 *
 * @returns {Promise<number>} process exit code.
 */
export async function main({
  argv = process.argv.slice(2),
  cwd = WORKSPACE_ROOT,
  out = (text) => process.stdout.write(text),
  fetch: shouldFetch = true,
} = {}) {
  const git = (args) => runGit(args, cwd);
  const branch = flag(argv, '--branch', DEFAULT_BRANCH);
  const dryRun = argv.includes('--dry-run');
  const skipReleaseGate = argv.includes('--skip-release-gate');
  const mainRef = flag(argv, '--main-ref', 'origin/main');
  const developRef = flag(argv, '--develop-ref', 'origin/develop');
  const baseline = flag(argv, '--baseline', ADOPTION_BASELINE);

  const must = (args, what) => {
    const result = git(args);
    if (result.code !== 0) {
      throw new PromoteError(`${what} failed:\n${result.stderr || result.stdout}`);
    }
    return result.stdout;
  };

  /** Undo a partially-applied merge and put the caller back where they started. */
  const restore = (previousBranch, branchExisted) => {
    git(['merge', '--abort']);
    if (previousBranch) git(['checkout', '--quiet', previousBranch]);
    if (!branchExisted) git(['branch', '-D', branch]);
  };

  try {
    const dirty = must(['status', '--porcelain'], 'reading the working tree');
    if (dirty.length > 0) {
      throw new PromoteError(
        'the working tree is not clean. A promotion branch must be cut from a clean tree so the\n' +
          'promoted content is exactly what `develop` integrated.',
      );
    }

    if (shouldFetch) {
      out('promote: fetching origin…\n');
      must(['fetch', 'origin', '--prune'], 'git fetch');
    }

    const developSha = must(['rev-parse', developRef], `resolving ${developRef}`);
    const mainSha = must(['rev-parse', mainRef], `resolving ${mainRef}`);
    out(`promote: ${developRef} ${developSha.slice(0, 9)} → ${mainRef} ${mainSha.slice(0, 9)}\n`);

    if (git(['merge-base', '--is-ancestor', developRef, mainRef]).code === 0) {
      out(`promote: ${mainRef} already contains ${developRef} — nothing to promote.\n`);
      return 0;
    }

    // Try the merge as a pure OBJECT operation first, so a drifted `main` is reported BEFORE any
    // branch is created or the working tree is touched. `git merge-tree --write-tree` (git >= 2.38)
    // exits 0 for a clean merge and 1 for a conflicted one; ANY other non-zero is a git error (bad
    // ref, unsupported flag) and must not be misreported as a conflict — the remedies differ.
    const mergeTree = git(['merge-tree', '--write-tree', developRef, mainRef]);
    if (mergeTree.code !== 0 && mergeTree.code !== 1) {
      throw new PromoteError(
        `\`git merge-tree --write-tree\` failed (exit ${mergeTree.code}): ${mergeTree.stderr || '(no stderr)'}\n` +
          'This is a git error, not a merge conflict. `--write-tree` needs git >= 2.38.',
      );
    }
    if (mergeTree.code === 1) {
      throw new PromoteError(
        `merging \`${mainRef}\` into the promotion branch CONFLICTS.\n\n` +
          mergeTree.stdout +
          `\n\nThat means \`main\` carries content \`develop\` has never integrated — a \`hotfix/*\`, a\n` +
          'direct push, or a conflict-resolving merge. Do NOT resolve it inside the promotion:\n' +
          'back-merge `main` into `develop` on its own PR (merged as a MERGE COMMIT, never a squash),\n' +
          'then re-run this script. Resolving here is exactly the hand-derived resolution INFRA-051\n' +
          'removed.',
      );
    }

    const mergedTree = mergeTree.stdout.split('\n')[0].trim();
    const developTree = must(['rev-parse', `${developRef}^{tree}`], 'resolving the develop tree');
    if (mergedTree !== developTree) {
      throw new PromoteError(
        `merging \`${mainRef}\` changes develop's tree, so \`main\` holds content \`develop\` lacks.\n` +
          'Back-merge `main` into `develop` first (merge commit, never a squash), then re-run.',
      );
    }

    if (dryRun) {
      out(
        `promote: --dry-run — the merge is clean and promotes develop's tree unchanged (${mergedTree.slice(0, 9)}).\n`,
      );
      return 0;
    }

    const previousBranch = git(['branch', '--show-current']).stdout;
    const branchExisted =
      git(['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]).code === 0;

    out(`promote: creating ${branch} from ${developRef}…\n`);
    must(['checkout', '-B', branch, developRef], `creating ${branch}`);

    const merge = git([
      'merge',
      '--no-ff',
      mainRef,
      '-m',
      "chore(release): record main's ancestry into the promotion",
    ]);
    if (merge.code !== 0) {
      restore(previousBranch, branchExisted);
      throw new PromoteError(
        `git merge failed after the pre-flight said it would be clean:\n${merge.stderr || merge.stdout}\n` +
          'The merge was aborted and the branch state restored; re-run after fetching.',
      );
    }

    const head = must(['rev-parse', 'HEAD'], 'resolving the promotion head');
    const { findings, currentDebt } = evaluatePromotion({
      git,
      head,
      mainRef,
      developRef,
      baseline,
    });
    if (findings.length > 0) {
      const detail = findings.map((finding) => `  - [${finding.id}] ${finding.detail}`).join('\n');
      restore(previousBranch, branchExisted);
      throw new PromoteError(
        `the promotion branch does NOT satisfy the promotion-ancestry gate:\n${detail}\n` +
          'The branch was discarded rather than left behind half-built.',
      );
    }

    // The main-only gate, run HERE rather than discovered on the promotion PR.
    //
    // `release-grade verification` is required on `protect-main` and runs nowhere else, so a defect
    // it catches is invisible until the promotion PR is already open. Measured 2026-07-27: two
    // consecutive promotions failed on it — a timing-flaky test, then a fixture outside a newly
    // contained root — each costing an open-PR/CI/diagnose/fix/re-promote round trip. The command
    // below is byte-identical to what that job runs and was available both times.
    //
    // Default-on, because the cost of running it is bounded and the cost of skipping it was
    // measured. `--skip-release-gate` exists for a deliberate bypass and says so in the output, so
    // a skip is a visible choice rather than an omission.
    if (!skipReleaseGate) {
      out('\npromote: running the main-only release gate (pnpm harness:verify:release)…\n');
      const gate = spawnSync('pnpm', ['harness:verify:release'], {
        stdio: 'inherit',
        shell: false,
      });
      if (gate.status !== 0) {
        restore(previousBranch, branchExisted);
        throw new PromoteError(
          'the release gate FAILED, so the promotion branch was discarded rather than pushed.\n' +
            'This is the same check `release-grade verification` runs on the promotion PR — fixing it\n' +
            'here costs one local run instead of an open-PR round trip. Re-run promote when green.',
        );
      }
    }

    out(
      `\npromote: ${branch} is ready — A1/A2/A3 hold (non-merge debt on main: ${currentDebt}).` +
        `${skipReleaseGate ? '\npromote: RELEASE GATE SKIPPED (--skip-release-gate) — `release-grade verification` is unverified.' : '\npromote: release gate PASSED locally.'}\n` +
        `\nNext (promoting to \`main\` is a release-level action needing explicit user approval):\n` +
        `  git push -u origin ${branch}\n` +
        `  gh pr create --base main --head ${branch} --title "chore(release): promote develop to main"\n` +
        `  gh pr merge <n> --merge          # NEVER --squash; \`protect-main\` rejects it outright\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof PromoteError) {
      out(`promote: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  process.exitCode = await main();
}
