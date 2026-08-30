import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const reflogRace = vi.hoisted(() => ({ path: null, armed: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    openSync(file, ...args) {
      if (reflogRace.armed && file === reflogRace.path) {
        reflogRace.armed = false;
        rmSync(file);
      }
      return actual.openSync(file, ...args);
    },
  };
});

const { currentClaimIdentity } = await import('../work-run-git.mjs');
const branch = 'codex/work-run-git-race';

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000,
  }).trim();
}

function fixture() {
  const root = realpathSync(makeTemp('robota-work-run-git-'));
  git(root, 'init', '--quiet', '-b', 'develop');
  git(root, 'config', 'user.name', 'Work Run Git Test');
  git(root, 'config', 'user.email', 'work-run-git@example.test');
  git(root, 'config', 'core.hooksPath', '.git/no-hooks');
  git(root, 'remote', 'add', 'origin', 'https://github.com/woojubb/robota.git');
  writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, 'add', 'seed.txt');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'chore: seed repository');
  git(root, 'switch', '--quiet', '-c', branch);
  return { root, head: git(root, 'rev-parse', 'HEAD') };
}

describe('work-run git claim identity', () => {
  it('classifies a reflog removed immediately before opening as expired', () => {
    const { root, head } = fixture();
    reflogRace.path = git(
      root,
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      `logs/refs/heads/${branch}`,
    );
    reflogRace.armed = true;

    expect(currentClaimIdentity(root, branch, head)).toMatchObject({
      branchEpoch: null,
      branchEpochStatus: 'expired',
      headCommit: head,
    });
    expect(reflogRace.armed).toBe(false);
  });

  it('keeps a missing branch distinct from an expired reflog', () => {
    const { root, head } = fixture();
    git(root, 'switch', '--quiet', '--detach', head);
    git(root, 'branch', '-D', branch);

    expect(currentClaimIdentity(root, branch, head)).toMatchObject({
      branchEpoch: null,
      branchEpochStatus: 'unavailable',
      headCommit: head,
    });
  });
});
