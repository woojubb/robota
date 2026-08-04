import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_SRC = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * INFRA-070 — `git branch <name> [<start-point>]` creates a branch too.
 *
 * The guard detected creation as `checkout -b` / `switch -c`, and BOTH create-time checks hang off
 * that detection: the base the branch is cut from, and the name it is given. So
 *
 *     git branch my-branch main && git checkout my-branch
 *
 * reached neither — a branch cut from `main`, named outside the convention, created in two commands
 * the guard read as "not a creation". The rule named two spellings, which is the shape that leaves a
 * guard true on paper and reachable around in practice.
 *
 * Widening a matcher is the easy half. The half that decides whether the guard survives is that
 * `git branch` with no argument, `-a`, `-r`, `-v`, `--list`, `-d`/`-D` and `-m`/`-M` are LISTING and
 * DELETING and RENAMING, and must stay silent — a guard that refuses ordinary inspection is one
 * everybody learns to override.
 */

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function makeTemp(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** `main` and `origin/develop` at DIFFERENT commits, checked out on a feature branch at develop. */
function scratchRepo() {
  const dir = makeTemp('bg-branch-repo-');
  const run = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  run('init', '--quiet', '--initial-branch=develop');
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'chore: one');
  run('branch', 'main');
  writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'chore: two');
  run('update-ref', 'refs/remotes/origin/develop', 'develop');
  run('checkout', '--quiet', '-b', 'feat/base');
  run('remote', 'add', 'origin', 'https://example.invalid/scratch.git');
  return dir;
}

function hooksSandbox() {
  const dir = makeTemp('bg-branch-hooks-');
  const hooks = path.join(dir, '.claude', 'hooks');
  mkdirSync(path.dirname(hooks), { recursive: true });
  cpSync(HOOKS_SRC, hooks, { recursive: true });
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { hook: path.join(hooks, 'branch-guard.sh'), bin };
}

let repo;
let sandbox;

beforeAll(() => {
  repo = scratchRepo();
  sandbox = hooksSandbox();
});

function run(command) {
  const result = spawnSync('bash', [sandbox.hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }),
    encoding: 'utf8',
    cwd: repo,
    // Only PATH, HOME and the project dir: every BRANCH_GUARD_ALLOW_* is absent by construction, so
    // nothing below passes because the environment permitted it.
    env: {
      PATH: `${sandbox.bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      CLAUDE_PROJECT_DIR: repo,
    },
    timeout: 60_000,
  });
  return { status: result.status ?? -1, said: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('`git branch <name>` is a creation, and is judged as one', () => {
  it('refuses a name outside the convention', () => {
    const { status, said } = run('git branch BAD_NAME');

    expect(status, said).toBe(2);
    expect(said).toMatch(/BAD_NAME/);
  });

  it('refuses a branch cut from the wrong base', () => {
    // The form the item was filed for: it names its base explicitly. Detecting the creation while
    // failing to read that base would judge the branch against HEAD — a creation judged, and judged
    // against the wrong thing, which reads as a pass.
    const { status, said } = run('git branch feat/ok main');

    expect(status, said).toBe(2);
    expect(said).toMatch(/wrong base/);
  });

  it('refuses the two-command shape the item names, which reached neither check', () => {
    const { status, said } = run('git branch my-branch main && git checkout my-branch');

    expect(status, said).toBe(2);
  });

  it('permits the prescribed form, silently', () => {
    // Property 4: a guard that fires on correct work is a defect of the same severity as one that
    // misses a violation, and it is the one that gets the guard turned off.
    const { status, said } = run('git branch feat/ok origin/develop');

    expect(status, said).toBe(0);
    expect(said.trim()).toBe('');
  });

  it('honours the same overrides as the other spellings', () => {
    expect(run('BRANCH_GUARD_ALLOW_BASE=1 git branch feat/ok main').status).toBe(0);
    expect(run('BRANCH_GUARD_ALLOW_BADNAME=1 git branch BAD_NAME').status).toBe(0);
  });
});

describe('listing, deleting and renaming are not creations', () => {
  // Each proven SILENT, not merely permitted: a guard that narrates on the happy path is one people
  // learn to scroll past, after which its refusals scroll past too.
  const NOT_A_CREATION = [
    ['bare listing', 'git branch'],
    ['listing every ref', 'git branch -a'],
    ['listing remotes', 'git branch -r'],
    ['verbose listing', 'git branch -v'],
    ['explicit listing', 'git branch --list'],
    ['listing merged branches', 'git branch --merged'],
    ['the current branch', 'git branch --show-current'],
    ['a safe delete', 'git branch -d BAD_NAME'],
    ['a forced delete', 'git branch -D BAD_NAME'],
    ['a rename', 'git branch -m BAD_NAME other'],
  ];

  for (const [what, command] of NOT_A_CREATION) {
    it(`${what} passes with no output`, () => {
      const { status, said } = run(command);

      expect(status, said).toBe(0);
      expect(said.trim(), `\`${command}\` spoke`).toBe('');
    });
  }
});
