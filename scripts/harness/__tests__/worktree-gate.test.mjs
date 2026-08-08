/**
 * The mechanical half of the worktree gates, checked against the accidents it was written for.
 *
 * Each case reproduces one incident rather than exercising a code path: an inherited `GIT_DIR`, a
 * branch a sibling worktree holds, a worktree that was never installed, a handoff from the wrong
 * branch, and build output older than the source beside it. A check that cannot be shown failing on
 * its own incident is a check nobody should trust.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ambientGitEnvFindings,
  branchHeldElsewhereFindings,
  dependenciesInstalledFindings,
  headMatchesFindings,
  listWorktrees,
  staleBuildFindings,
} from '../worktree-gate.mjs';

const GIT_IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

function git(dir, ...args) {
  return execFileSync('git', [...GIT_IDENTITY, '-C', dir, ...args], { encoding: 'utf8' }).trim();
}

let root;
let repo;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'worktree-gate-'));
  repo = path.join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ambient git environment', () => {
  it('names every variable that would redirect a git command', () => {
    const findings = ambientGitEnvFindings({ GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/tree' });

    expect(findings.map((f) => f.check)).toEqual(['ambient-git-env', 'ambient-git-env']);
    expect(findings[0].detail).toMatch(/GIT_DIR/);
  });

  it('treats an EMPTY variable as unset', () => {
    // `GIT_DIR=` is not the same as `GIT_DIR` being absent to git, but it is to this question: an
    // empty value redirects nothing. Reading it as set was a real bug in the sibling fix that
    // deletes these variables for tests, and it broke four fixtures before it was caught.
    expect(ambientGitEnvFindings({ GIT_DIR: '' })).toEqual([]);
  });

  it('says nothing when the environment is clean', () => {
    expect(ambientGitEnvFindings({ PATH: '/usr/bin' })).toEqual([]);
  });
});

describe('a branch another worktree holds', () => {
  it('names the worktree holding it', () => {
    const held = 'held-elsewhere';
    git(repo, 'branch', held);
    const sibling = path.join(root, 'sibling');
    git(repo, 'worktree', 'add', '-q', sibling, held);

    try {
      const findings = branchHeldElsewhereFindings(held, repo);

      expect(findings).toHaveLength(1);
      expect(findings[0].check).toBe('branch-held-elsewhere');
      expect(findings[0].detail).toContain(sibling);
    } finally {
      git(repo, 'worktree', 'remove', '--force', sibling);
    }
  });

  it('does not object to the branch THIS worktree is on', () => {
    // The checked-out branch is held by a worktree — this one. Reporting it would make the gate fire
    // on every correct start, which is what gets a gate routed around.
    const current = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

    expect(branchHeldElsewhereFindings(current, repo)).toEqual([]);
  });

  it('lists every worktree and the branch each one holds', () => {
    const worktrees = listWorktrees(repo);

    expect(worktrees.length).toBeGreaterThanOrEqual(1);
    expect(worktrees[0].path).toBeTruthy();
  });
});

describe('a worktree that was never installed', () => {
  it('reports the missing install', () => {
    const findings = dependenciesInstalledFindings(repo);

    expect(findings.map((f) => f.check)).toEqual(['dependencies-missing']);
  });

  it('says nothing once node_modules exists', () => {
    const installed = path.join(root, 'installed');
    mkdirSync(path.join(installed, 'node_modules'), { recursive: true });

    expect(dependenciesInstalledFindings(installed)).toEqual([]);
  });
});

describe('the branch being handed off', () => {
  it('reports a handoff from a different branch than the one verified', () => {
    const findings = headMatchesFindings('some-other-branch', repo);

    expect(findings.map((f) => f.check)).toEqual(['head-mismatch']);
    expect(findings[0].detail).toMatch(/verified against a different branch/);
  });

  it('says nothing when HEAD is the branch claimed', () => {
    const current = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

    expect(headMatchesFindings(current, repo)).toEqual([]);
  });
});

describe('build output left behind by another branch', () => {
  /** A package whose `dist` was built at `builtAt` and whose `src` changed at `changedAt`. */
  function makePackage(name, builtAt, changedAt) {
    const pkg = path.join(root, 'ws', 'packages', name);
    mkdirSync(path.join(pkg, 'src'), { recursive: true });
    mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    const dist = path.join(pkg, 'dist', 'index.js');
    const src = path.join(pkg, 'src', 'index.ts');
    writeFileSync(dist, '// built\n');
    writeFileSync(src, '// source\n');
    utimesSync(dist, builtAt / 1000, builtAt / 1000);
    utimesSync(src, changedAt / 1000, changedAt / 1000);
  }

  const EARLIER = 1_700_000_000_000;
  const LATER = EARLIER + 60_000;

  it('reports a package whose src is newer than its dist', () => {
    makePackage('stale-one', EARLIER, LATER);

    const findings = staleBuildFindings(path.join(root, 'ws'));

    expect(findings.map((f) => f.check)).toContain('stale-build-output');
    expect(findings.some((f) => f.detail.includes('stale-one'))).toBe(true);
  });

  it('says nothing about a package built after its last source change', () => {
    rmSync(path.join(root, 'ws'), { recursive: true, force: true });
    makePackage('fresh-one', LATER, EARLIER);

    expect(staleBuildFindings(path.join(root, 'ws'))).toEqual([]);
  });

  it('says nothing about a package that was never built', () => {
    // Unbuilt is not stale. Conflating them would make this fire on every clean worktree, which is
    // the state a worktree STARTS in — the check would be noise from its first run.
    const pkg = path.join(root, 'unbuilt', 'packages', 'never-built');
    mkdirSync(path.join(pkg, 'src'), { recursive: true });
    writeFileSync(path.join(pkg, 'src', 'index.ts'), '// source\n');

    expect(staleBuildFindings(path.join(root, 'unbuilt'))).toEqual([]);
  });
});

describe('the gate refuses to run without the argument its checks need', () => {
  const GATE = path.resolve(import.meta.dirname, '../worktree-gate.mjs');

  /** Run the gate as a process, the way the skill and the agents invoke it. */
  function runGate(...args) {
    const result = spawnSync('node', [GATE, ...args], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('REFUSES a run with no --branch instead of passing over the checks it needs it for', () => {
    // Review: `--branch` was validated nowhere and the usage string spelled it `[--branch <name>]`.
    // `branchHeldElsewhereFindings` and `headMatchesFindings` both return `[]` the moment `branch`
    // is falsy, so a run without it skipped at least one core check per phase and still printed
    // `worktree-gate (...) passed.`
    //
    // That is the silent green this gate exists to remove, in the gate itself — its own stated
    // purpose is that none of these checks "should depend on someone remembering".
    for (const args of [
      ['--phase', 'before'],
      ['--phase', 'after'],
    ]) {
      const { status, output } = runGate(...args);
      expect(status, args.join(' ')).toBe(2);
      expect(output).toMatch(/--branch <name> is required/);
      expect(output, 'it must not report a pass it did not compute').not.toMatch(/passed\./);
    }
  });

  it('REFUSES a --branch whose value is the next FLAG', () => {
    // `--branch --phase after` would otherwise take `--phase` as the branch name and check a branch
    // nothing can be holding — a pass computed over a name that does not exist.
    const { status, output } = runGate('--phase', 'before', '--branch', '--phase');
    expect(status).toBe(2);
    expect(output).toMatch(/--branch <name> is required/);
  });
});
