import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { evaluatePromotion, resolveBase, resolveHead } from '../scan-promotion-ancestry.mjs';

/**
 * These fixtures build REAL git repositories, because the property under test is a property of the
 * commit graph — a mocked git would only test the mock. Each topology is named after the real event
 * it reproduces (INFRA-051).
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

async function newRepo() {
  const root = makeTemp('robota-promotion-ancestry-');
  roots.push(root);
  const git = makeGit(root);
  git(['init', '--quiet', '--initial-branch=develop']);
  git(['config', 'user.email', 'harness@example.test']);
  git(['config', 'user.name', 'Harness']);
  git(['config', 'commit.gpgsign', 'false']);
  return { root, git };
}

function commit(root, git, file, body, message) {
  writeFileSync(path.join(root, file), body, 'utf8');
  git(['add', file]);
  git(['commit', '--quiet', '-m', message]);
  return git(['rev-parse', 'HEAD']).stdout;
}

function ids(findings) {
  return findings.map((finding) => finding.id).sort();
}

/**
 * Shared prologue: a shared root, then a commit that lands on `main` DIRECTLY (the #1216 /
 * Dependabot shape) so `main` holds content `develop`'s ancestry lacks. `baseline` is set to the
 * shared root, i.e. no amnesty — the direct landing is post-baseline debt, exactly as a NEW one
 * would be.
 */
async function repoWithDirectLandingOnMain() {
  const { root, git } = await newRepo();
  const rootSha = commit(root, git, 'README.md', 'root\n', 'chore: root');
  git(['branch', 'main']);
  git(['checkout', '--quiet', 'main']);
  commit(root, git, 'package.json', '{"deps":"bumped"}\n', 'chore(deps): bump on main directly');
  git(['checkout', '--quiet', 'develop']);
  commit(root, git, 'feature.txt', 'develop work\n', 'feat: develop work');
  return { root, git, baseline: rootSha };
}

describe('promotion-ancestry gate (INFRA-051)', () => {
  it('is RED on the measured defect: a SQUASHED back-merge copies content but records no ancestry', async () => {
    const { root, git, baseline } = await repoWithDirectLandingOnMain();

    // The #1415 shape: `main -> develop` squash-merged. Content lands on develop as ONE commit with
    // a SINGLE parent — `bc0ee64ff`. `git merge --squash` is precisely what the GitHub squash button does.
    git(['merge', '--squash', 'main']);
    git(['commit', '--quiet', '-m', 'chore(deps): sync main dependency majors into develop']);
    // The squash commit has exactly one parent — the ancestry link is absent.
    expect(git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.split(' ')).toHaveLength(2);

    // The promotion is then attempted from develop's tip, as #1413 was.
    const head = git(['rev-parse', 'develop']).stdout;
    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });

    expect(ids(findings)).toContain('A1');
    expect(findings.find((f) => f.id === 'A1').detail).toMatch(/NOT an ancestor/);
  });

  it('is GREEN once the promotion branch records main’s ancestry with a merge commit', async () => {
    const { git, baseline } = await repoWithDirectLandingOnMain();

    // The prescribed construction: cut from develop, then MERGE main in (no squash).
    git(['checkout', '--quiet', '-B', 'release/promote-develop-to-main', 'develop']);
    const merged = git(['merge', '--no-ff', '--no-edit', 'main']);
    expect(merged.code).toBe(0);

    const head = git(['rev-parse', 'HEAD']).stdout;
    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });

    // A1 holds. A2/A3 correctly still flag the pre-existing direct landing on `main` — it is real
    // divergence, and this fixture deliberately grants it no amnesty.
    expect(ids(findings)).not.toContain('A1');
    expect(ids(findings)).toEqual(['A2', 'A3']);
  });

  it('is fully GREEN in the steady state: main is already in develop’s ancestry', async () => {
    const { root, git } = await newRepo();
    const baseline = commit(root, git, 'README.md', 'root\n', 'chore: root');
    git(['branch', 'main']);
    commit(root, git, 'feature.txt', 'develop work\n', 'feat: develop work');

    git(['checkout', '--quiet', '-B', 'release/promote-develop-to-main', 'develop']);
    git(['merge', '--no-ff', '--no-edit', 'main']); // no-op: main is already an ancestor
    const head = git(['rev-parse', 'HEAD']).stdout;

    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });
    expect(findings).toEqual([]);
  });

  it('stays GREEN across repeated cycles when each promotion lands as a merge commit', async () => {
    const { root, git } = await newRepo();
    const baseline = commit(root, git, 'README.md', 'root\n', 'chore: root');
    git(['branch', 'main']);

    for (let cycle = 1; cycle <= 3; cycle += 1) {
      git(['checkout', '--quiet', 'develop']);
      commit(root, git, `cycle-${cycle}.txt`, `${cycle}\n`, `feat: cycle ${cycle}`);

      git(['checkout', '--quiet', '-B', 'release/promote', 'develop']);
      git(['merge', '--no-ff', '--no-edit', 'main']);
      const head = git(['rev-parse', 'HEAD']).stdout;

      const { findings } = evaluatePromotion({
        git,
        head,
        mainRef: 'main',
        developRef: 'develop',
        baseline,
      });
      expect({ cycle, findings }).toEqual({ cycle, findings: [] });

      // Land it on main the way `protect-main` now forces: a merge commit, never a squash.
      git(['checkout', '--quiet', 'main']);
      git(['merge', '--no-ff', '--no-edit', 'release/promote']);
    }
  });

  it('is RED when a PREVIOUS promotion was squashed onto main (A2)', async () => {
    const { root, git } = await newRepo();
    const baseline = commit(root, git, 'README.md', 'root\n', 'chore: root');
    git(['branch', 'main']);
    commit(root, git, 'cycle-1.txt', '1\n', 'feat: cycle 1');

    // The promotion is SQUASHED onto main: its content is copied, its ancestry is not.
    git(['checkout', '--quiet', 'main']);
    git(['merge', '--squash', 'develop']);
    git(['commit', '--quiet', '-m', 'chore(release): promote develop to main']);

    // Next cycle, built exactly as prescribed.
    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'cycle-2.txt', '2\n', 'feat: cycle 2');
    git(['checkout', '--quiet', '-B', 'release/promote', 'develop']);
    git(['merge', '--no-ff', '--no-edit', 'main']);
    const head = git(['rev-parse', 'HEAD']).stdout;

    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });
    expect(ids(findings)).toContain('A2');
    expect(findings.find((f) => f.id === 'A2').detail).toMatch(/promote develop to main/);
  });

  it('is RED on an EVIL merge, which A2 cannot see by construction (A3)', async () => {
    const { root, git } = await newRepo();
    const baseline = commit(root, git, 'README.md', 'root\n', 'chore: root');
    git(['branch', 'main']);
    commit(root, git, 'cycle-1.txt', '1\n', 'feat: cycle 1');

    // A promotion merge onto main whose tree matches NEITHER parent — content introduced by the
    // merge commit itself. `--no-merges` is blind to this; only the tree assertion sees it.
    git(['checkout', '--quiet', 'main']);
    git(['merge', '--no-ff', '--no-edit', '--no-commit', 'develop']);
    writeFileSync(path.join(root, 'resolved.txt'), 'hand-resolved on main only\n', 'utf8');
    git(['add', 'resolved.txt']);
    git(['commit', '--quiet', '-m', 'chore(release): promote develop to main']);

    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'cycle-2.txt', '2\n', 'feat: cycle 2');
    git(['checkout', '--quiet', '-B', 'release/promote', 'develop']);
    git(['merge', '--no-ff', '--no-edit', 'main']);
    const head = git(['rev-parse', 'HEAD']).stdout;

    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });
    expect(ids(findings)).not.toContain('A2'); // the blind spot, demonstrated
    expect(ids(findings)).toContain('A3');
    expect(findings.find((f) => f.id === 'A3').detail).toMatch(/resolved\.txt/);
  });

  /**
   * The amnesty must cut in exactly one direction. Without this fixture, deleting the `^${baseline}`
   * exclusion from A2 leaves every other test green — the exclusion would be guarding nothing
   * (measured by mutation during PR review). One commit on each side of the baseline pins both edges.
   */
  it('amnesties PRE-baseline debt on main and still reports POST-baseline debt', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'README.md', 'root\n', 'chore: root');
    git(['branch', 'main']);

    // Pre-baseline: a direct landing on `main`, then freeze the baseline at that commit.
    git(['checkout', '--quiet', 'main']);
    commit(root, git, 'legacy.json', '{"legacy":true}\n', 'chore(deps): legacy direct landing');
    const baseline = git(['rev-parse', 'HEAD']).stdout;

    // Post-baseline: a NEW direct landing, which no amnesty may cover.
    commit(root, git, 'fresh.json', '{"fresh":true}\n', 'chore(deps): fresh direct landing');

    git(['checkout', '--quiet', 'develop']);
    commit(root, git, 'feature.txt', 'develop work\n', 'feat: develop work');
    git(['checkout', '--quiet', '-B', 'release/promote', 'develop']);
    git(['merge', '--no-ff', '--no-edit', 'main']);
    const head = git(['rev-parse', 'HEAD']).stdout;

    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });

    const a2 = findings.find((finding) => finding.id === 'A2');
    expect(a2).toBeDefined();
    expect(a2.detail).toMatch(/fresh direct landing/);
    expect(a2.detail).not.toMatch(/legacy direct landing/);
    expect(a2.detail).toMatch(/carries 1 non-merge commit/);
  });

  it('fails loudly when the frozen baseline is unreachable rather than widening the amnesty', async () => {
    const { root, git } = await newRepo();
    commit(root, git, 'README.md', 'root\n', 'chore: root');
    git(['branch', 'main']);
    const head = git(['rev-parse', 'HEAD']).stdout;

    const { findings } = evaluatePromotion({
      git,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline: '0000000000000000000000000000000000000000',
    });
    expect(ids(findings)).toEqual(['BASELINE']);
  });

  it('reports a missing ref instead of passing over truncated ancestry', async () => {
    const { root, git } = await newRepo();
    const baseline = commit(root, git, 'README.md', 'root\n', 'chore: root');
    const { findings } = evaluatePromotion({
      git,
      head: 'develop',
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });
    expect(ids(findings)).toEqual(['REF']);
  });

  /**
   * A2 and A3 gather their evidence with commands whose EMPTY output means "assertion satisfied".
   * `runGit` maps any git failure to `{ code: 1, stdout: '' }`, so an unchecked exit code would turn a
   * broken git into a silent pass — a real trigger being `--no-commit-header` on git < 2.33.
   */
  it('fails closed when the git commands backing A2/A3 error out', async () => {
    const { root, git: realGit } = await newRepo();
    const baseline = commit(root, realGit, 'README.md', 'root\n', 'chore: root');
    realGit(['branch', 'main']);
    commit(root, realGit, 'feature.txt', 'develop work\n', 'feat: develop work');
    const head = realGit(['rev-parse', 'develop']).stdout;

    const brokenGit = (args) => {
      if (args[0] === 'rev-list' || args[0] === 'diff') {
        return { code: 128, stdout: '', stderr: 'fatal: unknown option' };
      }
      return realGit(args);
    };

    const { findings } = evaluatePromotion({
      git: brokenGit,
      head,
      mainRef: 'main',
      developRef: 'develop',
      baseline,
    });
    expect(ids(findings)).toEqual(['A2', 'A3']);
    for (const finding of findings) {
      expect(finding.detail).toMatch(/Refusing to report a pass for an assertion that never ran/);
    }
  });
});

describe('promotion head resolution', () => {
  it('refuses HEAD on a pull_request event — refs/pull/N/merge would pass A1 vacuously', () => {
    const { head, error } = resolveHead({ argv: [], env: { GITHUB_EVENT_NAME: 'pull_request' } });
    expect(head).toBeUndefined();
    expect(error).toMatch(/refs\/pull\/N\/merge/);
  });

  it('accepts an explicit head sha from the flag or the environment', () => {
    expect(resolveHead({ argv: ['--head', 'abc123'], env: {} }).head).toBe('abc123');
    expect(
      resolveHead({ argv: [], env: { GITHUB_EVENT_NAME: 'pull_request', PR_HEAD_SHA: 'def456' } })
        .head,
    ).toBe('def456');
  });

  it('reads the promotion base from --base or GITHUB_BASE_REF', () => {
    expect(resolveBase({ argv: ['--base', 'main'], env: {} })).toBe('main');
    expect(resolveBase({ argv: [], env: { GITHUB_BASE_REF: 'develop' } })).toBe('develop');
    expect(resolveBase({ argv: [], env: {} })).toBe('');
  });
});
