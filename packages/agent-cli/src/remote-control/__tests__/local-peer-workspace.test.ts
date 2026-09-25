/**
 * #3101 (B2) — how two sessions on one host are related by workspace, over REAL git repositories.
 *
 * A stubbed git would show that the module compares the strings it was handed. What has to hold is
 * that the reader's own reading of the filesystem decides the relation, so these cases build the
 * repositories, worktrees and clones the relation names.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  hashOriginUrl,
  judgeWorkspaceRelation,
  readWorkspaceClaim,
} from '../local-peer-workspace.js';

const scratch: string[] = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

function directory(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-workspace-')));
  scratch.push(dir);
  return dir;
}

/** Git with no inherited `GIT_*` state, so a run inside a hook cannot point at this checkout. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function repository(origin?: string): string {
  const dir = directory();
  git(dir, 'init', '-q');
  // The message names the directory: two identical empty commits in one second share a hash.
  git(dir, 'commit', '-q', '--allow-empty', '-m', `root ${dir}`);
  if (origin !== undefined) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}

describe('the relation the reader computes', () => {
  it('two sessions in one worktree are same-worktree', () => {
    const repo = repository();
    const subdirectory = path.join(repo, 'packages');
    mkdirSync(subdirectory);
    const own = readWorkspaceClaim(repo);
    const peer = readWorkspaceClaim(subdirectory);
    expect(judgeWorkspaceRelation(own, peer)).toEqual({
      relation: 'same-worktree',
      claim: 'verified',
    });
  });

  it('two worktrees of one repository are same-repo', () => {
    const repo = repository();
    const worktree = path.join(directory(), 'second');
    git(repo, 'worktree', 'add', '-q', worktree);
    expect(judgeWorkspaceRelation(readWorkspaceClaim(repo), readWorkspaceClaim(worktree))).toEqual({
      relation: 'same-repo',
      claim: 'verified',
    });
  });

  it('two clones of one repository are same-repo', () => {
    const repo = repository();
    const clone = path.join(directory(), 'clone');
    git(path.dirname(clone), 'clone', '-q', repo, clone);
    expect(judgeWorkspaceRelation(readWorkspaceClaim(repo), readWorkspaceClaim(clone))).toEqual({
      relation: 'same-repo',
      claim: 'verified',
    });
  });

  it('different repositories are different-repo', () => {
    expect(
      judgeWorkspaceRelation(readWorkspaceClaim(repository()), readWorkspaceClaim(repository())),
    ).toEqual({ relation: 'different-repo', claim: 'verified' });
  });

  it('a non-git directory is unknown, and publishes no claim', () => {
    const plain = directory();
    expect(readWorkspaceClaim(plain)).toBeUndefined();
    expect(judgeWorkspaceRelation(readWorkspaceClaim(repository()), undefined)).toEqual({
      relation: 'unknown',
      claim: 'absent',
    });
    // The reader outside git cannot relate itself to anything either.
    expect(judgeWorkspaceRelation(undefined, readWorkspaceClaim(repository()))).toEqual({
      relation: 'unknown',
      claim: 'verified',
    });
  });
});

describe('a claim is verified, not trusted', () => {
  it('does not believe a claim naming another repository’s root commits', () => {
    const own = readWorkspaceClaim(repository());
    const theirs = readWorkspaceClaim(repository());
    // A peer that says it sits in an unrelated repository while claiming OUR history.
    const forged = { ...theirs!, rootCommits: own!.rootCommits };
    expect(judgeWorkspaceRelation(own, forged)).toEqual({
      relation: 'unknown',
      claim: 'mismatched',
    });
  });

  it('does not believe a claim naming our worktree through a path that does not resolve to it', () => {
    const repo = repository();
    const link = path.join(directory(), 'link');
    symlinkSync(repo, link);
    const own = readWorkspaceClaim(repo);
    expect(judgeWorkspaceRelation(own, { ...own!, worktreePath: link })).toEqual({
      relation: 'unknown',
      claim: 'mismatched',
    });
  });

  it('does not believe a claim whose path is not a git worktree at all', () => {
    const own = readWorkspaceClaim(repository());
    expect(judgeWorkspaceRelation(own, { ...own!, worktreePath: directory() })).toEqual({
      relation: 'unknown',
      claim: 'mismatched',
    });
  });

  it('does not believe a claim whose origin differs from the one the reader reads', () => {
    const repo = repository('https://example.invalid/a/b.git');
    const own = readWorkspaceClaim(repo);
    expect(
      judgeWorkspaceRelation(own, { ...own!, originUrlHash: hashOriginUrl('https://x/y') }),
    ).toEqual({ relation: 'unknown', claim: 'mismatched' });
  });

  it('treats a malformed claim as mismatched rather than as absent', () => {
    expect(judgeWorkspaceRelation(undefined, { worktreePath: 42 })).toEqual({
      relation: 'unknown',
      claim: 'mismatched',
    });
  });
});

describe('the origin is published only as a hash of its normalized form', () => {
  it('equates the spellings of one remote and drops credentials', () => {
    const canonical = hashOriginUrl('https://github.com/owner/repo');
    expect(hashOriginUrl('https://user:secret@GitHub.com/owner/repo.git/')).toBe(canonical);
    expect(hashOriginUrl('git@github.com:owner/repo.git')).toBe(canonical);
    expect(hashOriginUrl('ssh://git@github.com/owner/repo')).toBe(canonical);
    expect(hashOriginUrl('https://github.com/owner/other')).not.toBe(canonical);
    expect(canonical).not.toContain('github');
  });

  it('carries the hash in the claim, never the URL', () => {
    const claim = readWorkspaceClaim(repository('https://token@example.invalid/a/b.git'));
    expect(JSON.stringify(claim)).not.toContain('token');
    expect(claim?.originUrlHash).toBe(hashOriginUrl('https://example.invalid/a/b'));
  });
});
