import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { main } from '../promote.mjs';
import { RECONCILED_BRANCHES, reconcileLive } from '../scan-main-required-checks.mjs';

/**
 * `git-branch.md` makes `promote.mjs` the ONLY sanctioned way to build a promotion branch ("never by
 * hand"), so its decision logic carries real release risk. These fixtures drive it against throwaway
 * repositories through the injected `cwd`/`out`/`fetch` seams (INFRA-051).
 */

const roots = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function makeGit(root) {
  return (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return {
      code: result.status ?? 1,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
    };
  };
}

function commit(root, git, file, body, message) {
  writeFileSync(path.join(root, file), body, 'utf8');
  git(['add', file]);
  git(['commit', '--quiet', '-m', message]);
  return git(['rev-parse', 'HEAD']).stdout;
}

/** A repo whose `main`/`develop` stand in for the remote-tracking refs, so no network is needed. */
async function newRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-promote-'));
  roots.push(root);
  const git = makeGit(root);
  git(['init', '--quiet', '--initial-branch=develop']);
  git(['config', 'user.email', 'harness@example.test']);
  git(['config', 'user.name', 'Harness']);
  git(['config', 'commit.gpgsign', 'false']);
  commit(root, git, 'README.md', 'root\n', 'chore: root');
  git(['branch', 'main']);
  return { root, git };
}

/**
 * INFRA-104 — the closing-keyword derivation reads GitHub, so it is INJECTED in every test.
 * Without this, the two ready-branch cases below reach the network and time out; a hermetic suite
 * must not depend on a live API to assert an ancestry invariant.
 */
const NO_CLOSES = () => '';

/**
 * issue #1980 — the ruleset reconciliation reads GitHub, so it is INJECTED for the same reason
 * `NO_CLOSES` is. `newRepo()` usually creates no `origin`, which makes `originSlug` return nothing
 * and the reconciliation return early — but the fetch case below adds a REAL local bare repo as
 * `origin`, and `originSlug` parses `/tmp/…/robota-promote-origin-XXXX` into the plausible-looking
 * slug `tmp/robota-promote-origin-XXXX`. That reaches `gh api` and the network, in a case whose own
 * comment promises none is needed.
 */
const NO_RECONCILE = () => [];

async function run(root, extraArgv = [], options = {}) {
  let output = '';
  // extraArgv first: `flag()` reads the FIRST occurrence, so a test override must precede the defaults.
  const code = await main({
    argv: [...extraArgv, '--main-ref', 'main', '--develop-ref', 'develop', '--baseline', 'develop'],
    cwd: root,
    out: (text) => {
      output += text;
    },
    fetch: false,
    closesBlock: NO_CLOSES,
    reconcileRulesets: NO_RECONCILE,
    ...options,
  });
  return { code, output };
}

async function runWithOptions(root, options) {
  let output = '';
  const code = await main({
    cwd: root,
    out: (text) => {
      output += text;
    },
    closesBlock: NO_CLOSES,
    reconcileRulesets: NO_RECONCILE,
    ...options,
  });
  return { code, output };
}

describe('promote.mjs (INFRA-051)', () => {
  it('refuses to run on a dirty working tree', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    writeFileSync(path.join(root, 'scratch.txt'), 'uncommitted\n', 'utf8');
    git(['add', 'scratch.txt']);

    const { code, output } = await run(root);
    expect(code).toBe(1);
    expect(output).toMatch(/working tree is not clean/);
  });

  it('reports nothing to promote when main already contains develop', async () => {
    const { root } = await newRepo();
    const { code, output } = await run(root);
    expect(code).toBe(0);
    expect(output).toMatch(/already contains/);
  });

  it('--dry-run reports a clean merge without creating the branch', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');

    const { code, output } = await run(root, ['--dry-run']);
    expect(code).toBe(0);
    expect(output).toMatch(/the merge is clean and promotes develop's tree unchanged/);
    expect(git(['rev-parse', '--verify', '--quiet', 'release/promote-develop-to-main']).code).toBe(
      1,
    );
    expect(git(['branch', '--show-current']).stdout).toBe('develop');
  });

  it('refuses a NON-conflicting merge that still drags main-only content across', async () => {
    const { root, git } = await newRepo();
    // A direct landing on `main` touching a file `develop` never touches: the merge is CLEAN, so a
    // conflict check alone would wave it through. Only the tree assertion catches it — and it must
    // catch it in the pre-flight, before any branch exists.
    git(['checkout', '--quiet', 'main']);
    commit(root, git, 'legacy.json', '{"legacy":true}\n', 'chore(deps): direct landing');
    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');

    const { code, output } = await run(root, ['--branch', 'release/promote']);
    expect(code).toBe(1);
    expect(output).not.toMatch(/CONFLICTS/);
    expect(output).toMatch(/changes develop's tree, so `main` holds content `develop` lacks/);
    expect(git(['rev-parse', '--verify', '--quiet', 'release/promote']).code).toBe(1);
    expect(git(['branch', '--show-current']).stdout).toBe('develop');
    expect(git(['status', '--porcelain']).stdout).toBe('');
  });

  it('leaves a ready promotion branch when the invariant holds', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');

    const { code, output } = await run(root, ['--branch', 'release/promote']);
    expect(code).toBe(0);
    expect(output).toMatch(/release\/promote is ready/);
    expect(git(['branch', '--show-current']).stdout).toBe('release/promote');
    // main is now an ancestor of the promotion head, and the tree is develop's, unchanged.
    expect(git(['merge-base', '--is-ancestor', 'main', 'HEAD']).code).toBe(0);
    expect(git(['rev-parse', 'HEAD^{tree}']).stdout).toBe(
      git(['rev-parse', 'develop^{tree}']).stdout,
    );
  });

  it('fetches fresh origin refs before constructing a promotion', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    const remote = await mkdtemp(path.join(tmpdir(), 'robota-promote-origin-'));
    roots.push(remote);
    makeGit(remote)(['init', '--bare', '--quiet']);
    git(['remote', 'add', 'origin', remote]);
    git(['push', '--quiet', 'origin', 'main', 'develop']);
    git(['update-ref', '-d', 'refs/remotes/origin/main']);
    git(['update-ref', '-d', 'refs/remotes/origin/develop']);

    const { code, output } = await runWithOptions(root, {
      argv: ['--dry-run', '--baseline', 'origin/develop'],
    });

    expect(code).toBe(0);
    expect(output).toMatch(/fetching origin/);
    expect(git(['rev-parse', '--verify', 'origin/main']).code).toBe(0);
    expect(git(['rev-parse', '--verify', 'origin/develop']).code).toBe(0);
  });

  it('restores an existing promotion branch when a post-merge ancestry check fails', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    git(['branch', 'release/promote', 'main']);
    const previousPromotionHead = git(['rev-parse', 'release/promote']).stdout;

    const { code, output } = await runWithOptions(root, {
      argv: [
        '--branch',
        'release/promote',
        '--main-ref',
        'main',
        '--develop-ref',
        'develop',
        '--baseline',
        'develop',
      ],
      fetch: false,
      runGitImpl: (args, cwd) => {
        if (args[0] === 'rev-list' && args.includes('--format=%h %s')) {
          return { code: 2, stdout: '', stderr: 'injected ancestry failure' };
        }
        return makeGit(cwd)(args);
      },
    });

    expect(code).toBe(1);
    expect(output).toMatch(/does NOT satisfy the promotion-ancestry gate/);
    expect(git(['branch', '--show-current']).stdout).toBe('develop');
    expect(git(['rev-parse', 'release/promote']).stdout).toBe(previousPromotionHead);
    expect(git(['status', '--porcelain']).stdout).toBe('');
  });

  it('resets a checked-out existing promotion branch after a post-merge failure', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    git(['checkout', '-b', 'release/promote', 'main']);
    const previousPromotionHead = git(['rev-parse', 'HEAD']).stdout;

    const { code } = await runWithOptions(root, {
      argv: [
        '--branch',
        'release/promote',
        '--main-ref',
        'main',
        '--develop-ref',
        'develop',
        '--baseline',
        'develop',
      ],
      fetch: false,
      runGitImpl: (args, cwd) => {
        if (args[0] === 'rev-list' && args.includes('--format=%h %s')) {
          return { code: 2, stdout: '', stderr: 'injected ancestry failure' };
        }
        return makeGit(cwd)(args);
      },
    });

    expect(code).toBe(1);
    expect(git(['branch', '--show-current']).stdout).toBe('release/promote');
    expect(git(['rev-parse', 'HEAD']).stdout).toBe(previousPromotionHead);
    expect(git(['status', '--porcelain']).stdout).toBe('');
  });

  it('returns to a detached head and removes a new promotion branch after failure', async () => {
    const { root, git } = await newRepo();
    const detachedHead = commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    git(['checkout', '--detach', detachedHead]);

    const { code } = await runWithOptions(root, {
      argv: [
        '--branch',
        'release/promote',
        '--main-ref',
        'main',
        '--develop-ref',
        'develop',
        '--baseline',
        'develop',
      ],
      fetch: false,
      runGitImpl: (args, cwd) => {
        if (args[0] === 'rev-list' && args.includes('--format=%h %s')) {
          return { code: 2, stdout: '', stderr: 'injected ancestry failure' };
        }
        return makeGit(cwd)(args);
      },
    });

    expect(code).toBe(1);
    expect(git(['branch', '--show-current']).stdout).toBe('');
    expect(git(['rev-parse', 'HEAD']).stdout).toBe(detachedHead);
    expect(git(['rev-parse', '--verify', '--quiet', 'release/promote']).code).toBe(1);
    expect(git(['status', '--porcelain']).stdout).toBe('');
  });

  it('stops before touching the tree when main carries conflicting content', async () => {
    const { root, git } = await newRepo();
    git(['checkout', '--quiet', 'main']);
    commit(root, git, 'shared.txt', 'main side\n', 'fix: hotfix on main');
    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'shared.txt', 'develop side\n', 'feat: develop side');

    const { code, output } = await run(root, ['--branch', 'release/promote']);
    expect(code).toBe(1);
    expect(output).toMatch(/CONFLICTS/);
    expect(output).toMatch(/Do NOT resolve it inside the promotion/);
    // No branch was created and the caller is still on develop with a clean tree.
    expect(git(['rev-parse', '--verify', '--quiet', 'release/promote']).code).toBe(1);
    expect(git(['branch', '--show-current']).stdout).toBe('develop');
    expect(git(['status', '--porcelain']).stdout).toBe('');
  });

  it('distinguishes a git error from a merge conflict', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');

    const { code, output } = await run(root, ['--main-ref', 'refs/heads/does-not-exist']);
    expect(code).toBe(1);
    expect(output).not.toMatch(/CONFLICTS/);
    expect(output).toMatch(/resolving refs\/heads\/does-not-exist failed/);
  });

  it('declares protected CI as the next release-verification owner', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.md', 'work\n', 'feat: something');

    const { code, output } = await run(root);

    expect(code).toBe(0);
    expect(output).toMatch(/release-grade verification.*protected CI/is);
    expect(output).toMatch(/optional diagnostic.*pnpm harness:verify:release/is);
    expect(output).not.toMatch(/PASSED locally|SKIPPED/);
  });
});

describe('promote.mjs — closing keywords for the promotion body (INFRA-104)', () => {
  it('prints the derived block, because the promotion is the only PR GitHub reads a keyword on', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work (#1802)');

    const { code, output } = await run(root, [], {
      closesBlock: () => '\npromote: paste this into the promotion PR body —\n\nCloses #1750\n',
    });

    expect(code).toBe(0);
    expect(output).toMatch(/Closes #1750/);
    // Ordering matters: the operator composes the body before running `gh pr create`.
    expect(output.indexOf('Closes #1750')).toBeLessThan(output.indexOf('gh pr create'));
  });

  it('says so LOUDLY when the block cannot be derived — silence would read as "nothing to close"', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work (#1802)');

    const { code, output } = await run(root, [], {
      closesBlock: () => {
        throw new Error('gh api: connection reset');
      },
    });

    // The promotion branch is ancestry-verified and must survive a transient GitHub read...
    expect(code).toBe(0);
    // ...but the failure is named, and it is not mistakable for an empty derivation.
    expect(output).toMatch(/COULD NOT derive the closing keywords/);
    expect(output).toMatch(/connection reset/);
    expect(output).toMatch(/NOT "nothing to close"/);
    expect(output).toMatch(/scan-promotion-closes/);
  });
});

/**
 * issue #1980 — the reconciliation has a home, and it is this tool.
 *
 * `.github/required-status-checks.json` declares what each ruleset must require; the OFFLINE half of
 * `scan-main-required-checks.mjs` proves every declared context can fail. Neither half can see the
 * ruleset move underneath it. That is `--live`'s job, and `--live` ran only from a workflow whose
 * `schedule:` was removed — so `protect-main` declared four contexts and required three for four
 * weeks, and nothing said so.
 *
 * These cases pin the three verdicts a promotion can get, and the third is the one that matters: an
 * UNREACHABLE reconciliation must never render as a clean one. "No answer" reading as "they match"
 * is the defect itself, one layer up.
 */
describe('promote.mjs reconciles the rulesets before the PR exists (issue #1980)', () => {
  const ready = async (root, reconcileRulesets) =>
    runWithOptions(root, {
      argv: ['--main-ref', 'main', '--develop-ref', 'develop', '--baseline', 'develop'],
      fetch: false,
      reconcileRulesets,
    });

  /** A promotable repository: develop ahead of main, nothing unmerged on main. */
  async function promotable() {
    const { root, git } = await newRepo();
    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    return root;
  }

  it('reports the reconciliation when the declarations match', async () => {
    const root = await promotable();
    const { code, output } = await ready(root, () => []);
    expect(code).toBe(0);
    expect(output).toMatch(/declarations reconcile against the live rulesets/);
  });

  it('WARNS with the finding when a ruleset does not match, and still promotes', async () => {
    const root = await promotable();
    const { code, output } = await ready(root, () => [
      { context: 'promotion closes', detail: 'the LIVE ruleset does not require it' },
    ]);
    // The branch is still built: a stale required list is not a reason to discard an
    // ancestry-verified promotion, and refusing here would put a GitHub read in the promotion's path.
    expect(code).toBe(0);
    expect(output).toMatch(/WARNING — a live ruleset does NOT match its declaration/);
    expect(output).toMatch(/promotion closes: the LIVE ruleset does not require it/);
    expect(output).toMatch(/does not block the promotion/);
    expect(output).toMatch(/is ready — A1\/A2\/A3 hold/);
  });

  /**
   * The shape a FAILED READ actually has, which is not a thrown error.
   *
   * `reconcileLiveBranch` catches its own read failures and returns `{ context: '(live)', detail }`
   * — the same shape a real drift finding has. An earlier cut of this case made the mock THROW,
   * which the real implementation cannot do, so it passed while a genuine outage rendered as
   * "the ruleset disagrees with its declaration". A report stating a verdict it never obtained is
   * this issue's own defect one layer up.
   */
  it('an UNREADABLE ruleset is reported as unreachable, NOT as a mismatch', async () => {
    const root = await promotable();
    const { code, output } = await ready(root, () => [
      { context: '(live)', detail: 'getaddrinfo ENOTFOUND api.github.com' },
    ]);
    expect(code).toBe(0);
    expect(output).toMatch(/could NOT reconcile the rulesets/);
    expect(output).toMatch(/ENOTFOUND/);
    expect(output).toMatch(/this is NOT "they match"/);
    // Both discriminators: neither the clean verdict nor the MISMATCH verdict may appear.
    expect(output).not.toMatch(/declarations reconcile against the live rulesets/);
    expect(output).not.toMatch(/WARNING — a live ruleset does NOT match/);
  });

  it('a thrown error is still reported as unreachable', async () => {
    const root = await promotable();
    const { code, output } = await ready(root, () => {
      throw new Error('spawn ENOENT');
    });
    expect(code).toBe(0);
    expect(output).toMatch(/could NOT reconcile the rulesets \(spawn ENOENT\)/);
    expect(output).not.toMatch(/WARNING — a live ruleset does NOT match/);
  });

  /**
   * Binds the rendering above to the REAL contract, offline. A repository with no `origin` makes
   * `originSlug` return nothing, and `reconcileLive` returns the `(live)` sentinel without any
   * network call — so this proves the shape the mock uses is the shape the implementation produces,
   * which is exactly what the earlier throwing mock did not.
   */
  it('reconcileLive really does return the `(live)` sentinel rather than throwing', async () => {
    const { root } = await newRepo();
    const findings = reconcileLive(root);
    // One per reconciled branch, and EVERY one carries the sentinel context rather than throwing.
    expect(findings).toHaveLength(RECONCILED_BRANCHES.length);
    expect(findings.every((f) => f.context === '(live)')).toBe(true);
    expect(findings.every((f) => /origin/.test(f.detail))).toBe(true);
  });
});

/**
 * issue #1980 — `--dry-run` is the CHEAP pre-check, so it is the path most likely to be the only one
 * anyone runs before deciding a promotion is fine. A reconciliation that reports only on the
 * expensive path is a warning delivered after the decision it should have informed.
 */
describe('promote.mjs --dry-run carries the reconciliation too (issue #1980)', () => {
  it('a mismatch is reported on the dry run, not only on the real build', async () => {
    const { root, git } = await newRepo();
    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');

    const { code, output } = await runWithOptions(root, {
      argv: [
        '--dry-run',
        '--main-ref',
        'main',
        '--develop-ref',
        'develop',
        '--baseline',
        'develop',
      ],
      fetch: false,
      reconcileRulesets: () => [
        { context: 'promotion closes', detail: 'the LIVE ruleset does not require it' },
      ],
    });

    expect(code).toBe(0);
    expect(output).toMatch(/--dry-run — the merge is clean/);
    expect(output).toMatch(/WARNING — a live ruleset does NOT match its declaration/);
    expect(output).toMatch(/promotion closes: the LIVE ruleset does not require it/);
  });
});

/**
 * issue #1980 — the hermetic promise, pinned.
 *
 * `newRepo()` usually has no `origin`, so the reconciliation returns early and nothing reaches the
 * network by accident. The fetch case adds a REAL local bare repository as `origin`, and
 * `originSlug` parses that path into a plausible-looking `owner/repo`. Without the injection in the
 * shared helpers, the default implementation runs `gh api` against it.
 *
 * This asserts the outcome that distinguishes the two: an injected reconciliation reports nothing,
 * while a real one against a slug derived from a temp path reports a finding. Remove
 * `reconcileRulesets: NO_RECONCILE` from the helpers and this fails.
 */
describe('the promote suite stays hermetic when a local origin exists (issue #1980)', () => {
  it('a repository with a real local origin produces no reconciliation output at all', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'feature.txt', 'work\n', 'feat: work');
    const remote = await mkdtemp(path.join(tmpdir(), 'robota-promote-origin-'));
    roots.push(remote);
    makeGit(remote)(['init', '--bare', '--quiet']);
    git(['remote', 'add', 'origin', remote]);
    git(['push', '--quiet', 'origin', 'main', 'develop']);

    const { code, output } = await runWithOptions(root, {
      argv: ['--dry-run', '--baseline', 'origin/develop'],
    });

    expect(code).toBe(0);
    // The injected reconciliation returns no findings, so the CLEAN line is the correct output.
    expect(output).toMatch(/declarations reconcile against the live rulesets/);
    // These two are the discriminators. Either one means the real implementation ran: a WARNING
    // because `gh api` judged a slug invented from a temp path, or the unreachable notice because
    // it tried and could not. Both require the network this case promises not to need.
    expect(output).not.toMatch(/WARNING — a live ruleset/);
    expect(output).not.toMatch(/could NOT reconcile the rulesets/);
  });
});
