import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { main } from '../promote.mjs';

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

async function run(root, extraArgv = []) {
  let output = '';
  // extraArgv first: `flag()` reads the FIRST occurrence, so a test override must precede the defaults.
  const code = await main({
    argv: [...extraArgv, '--main-ref', 'main', '--develop-ref', 'develop', '--baseline', 'develop'],
    cwd: root,
    out: (text) => {
      output += text;
    },
    fetch: false,
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
