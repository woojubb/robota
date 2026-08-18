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

import path from 'node:path';

import { ADOPTION_BASELINE, evaluatePromotion, runGit } from './scan-promotion-ancestry.mjs';
import {
  collectClosingLines,
  createGitHubReaders,
  parsePullRequestNumbers,
  renderBlock,
  resolveRepository,
} from './promotion-closes.mjs';

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
 * INFRA-104 — the promotion body's closing keywords, derived from the pull requests it carries.
 *
 * Reads the pull-request BODIES, not the commit messages: GitHub's squash body concatenates the
 * commit messages and drops the PR description, so `Closes #N` is not in the commit (measured on
 * `93d061dd3`, the squash of PR #1802).
 */
function defaultClosesBlock({ mainRef, developRef, git }) {
  const log = git(['log', '--format=%s', `${mainRef}..${developRef}`]);
  if (log.code !== 0) {
    throw new Error(`git log ${mainRef}..${developRef} failed: ${log.stderr || log.stdout}`);
  }
  const subjects = log.stdout.split('\n').filter((line) => line.trim() !== '');
  const { lines } = collectClosingLines({
    pullNumbers: parsePullRequestNumbers(subjects),
    ...createGitHubReaders(resolveRepository(process.env.GITHUB_REPOSITORY)),
  });
  const block = renderBlock(lines);
  return block ? `\npromote: paste this into the promotion PR body —\n\n${block}` : '';
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
  runGitImpl = runGit,
  closesBlock = defaultClosesBlock,
} = {}) {
  const git = (args) => runGitImpl(args, cwd);
  const branch = flag(argv, '--branch', DEFAULT_BRANCH);
  const dryRun = argv.includes('--dry-run');
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
  const restore = (previousBranch, previousHead, branchExisted, previousBranchHead) => {
    git(['merge', '--abort']);
    if (previousBranch === branch && previousBranchHead) {
      git(['reset', '--hard', previousBranchHead]);
      return;
    }
    if (previousBranch) {
      git(['checkout', '--quiet', previousBranch]);
    } else if (previousHead) {
      git(['checkout', '--quiet', '--detach', previousHead]);
    }
    if (branchExisted && previousBranchHead) {
      git(['branch', '-f', branch, previousBranchHead]);
    } else if (!branchExisted) {
      git(['branch', '-D', branch]);
    }
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
    const previousHead = git(['rev-parse', 'HEAD']).stdout;
    const branchExisted =
      git(['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]).code === 0;
    const previousBranchHead = branchExisted
      ? git(['rev-parse', `${branch}^{commit}`]).stdout
      : undefined;

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
      restore(previousBranch, previousHead, branchExisted, previousBranchHead);
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
      restore(previousBranch, previousHead, branchExisted, previousBranchHead);
      throw new PromoteError(
        `the promotion branch does NOT satisfy the promotion-ancestry gate:\n${detail}\n` +
          'The branch was discarded rather than left behind half-built.',
      );
    }

    // INFRA-104. The keyword every work PR wrote was ignored — GitHub reads a closing keyword only
    // on a pull request targeting the DEFAULT branch, and work PRs target `develop`. This promotion
    // is the only PR that targets `main`, so it is the only place the keywords can act. The block is
    // derived here and printed for the promotion body; `scan-promotion-closes` (a required check on
    // `protect-main`) refuses the promotion if the body omits one.
    let closesSection = '';
    try {
      closesSection = closesBlock({ mainRef, developRef, git });
    } catch (error) {
      // allow-fallback: the block is an AID to composing the body, not the guarantee — the required
      // `scan-promotion-closes` check is. A transient GitHub read must not discard an
      // ancestry-verified promotion branch, and this path is LOUD: it names the failure and says the
      // promotion will be refused until the lines are supplied, so it can never read as "nothing to
      // close". Silence here would be the INFRA-104 defect itself, one layer up.
      closesSection =
        `\npromote: COULD NOT derive the closing keywords (${error.message}).\n` +
        'promote: this is NOT "nothing to close". Run `node scripts/harness/promotion-closes.mjs ' +
        '--base origin/main --head origin/develop` and paste its output into the PR body — the ' +
        'required `scan-promotion-closes` check will refuse the promotion until you do.\n';
    }

    out(
      `\npromote: ${branch} is ready — A1/A2/A3 hold (non-merge debt on main: ${currentDebt}).` +
        '\npromote: `release-grade verification` runs once in protected CI on the promotion PR.\n' +
        'promote: optional diagnostic before push: `pnpm harness:verify:release`.\n' +
        closesSection +
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
