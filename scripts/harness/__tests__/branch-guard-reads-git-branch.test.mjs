import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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

describe('the copy forms create a branch too, and are refused rather than parsed', () => {
  // Found by review on the first version of this change, which widened `git branch <name>` and then
  // claimed in `git-branch.md` to cover "every spelling that CREATES a branch". `git branch -c` was
  // a fourth one, and it slipped through the same allowlist that makes the widening safe.
  //
  // Refused, not parsed, and the reason is the argument ORDER: `-c <new>` names the branch first,
  // `-c <old> <new>` names it SECOND with the base first — the reverse of every other spelling here.
  // Running both arities through the same positional extraction is where a verdict goes silently
  // backwards: the new branch's name judged against the source branch, or its base against itself.
  // This guard has twice shipped a parser defect that refused the creation of the branch its own fix
  // lived on, so a clear refusal on a form no workflow prescribes beats a confident wrong answer.
  const COPY_SPELLINGS = [
    ['short copy, one argument', 'git branch -c BAD_NAME'],
    ['short copy, two arguments', 'git branch -c main feat/ok'],
    ['force copy', 'git branch -C feat/x'],
    ['long copy', 'git branch --copy a b'],
    ['long force copy', 'git branch --force-copy a b'],
    ['copy behind a flag', 'git branch -q -c a b'],
    // Found by review of the FIRST fix, and it was a bypass that fix created. The copy matcher was
    // given its own hand-typed flag list, SHORTER than the creation matcher's, so
    // `git branch --track -c old new` matched neither: not a copy (its list lacked `--track`) and
    // not a creation (that one requires the next token to be a non-flag, and `-c` is one). Detected
    // as neither, it passed through the guard entirely — the exact bypass this item exists to close,
    // opened inside the fix for it, by the second spelling this file's own header warns about.
    ['tracking flag before the copy', 'git branch --track -c old new'],
    ['short tracking flag before the copy', 'git branch -t -c old new'],
    ['no-track before a force copy', 'git branch --no-track -C a b'],
    // Third round of the same defect: the flag ALLOWLIST could not describe git's flag grammar.
    // `--track=direct` is the `=` form and `-qf` is bundled shorts; neither is a token in any list
    // anyone would think to write, and each was a silent pass. The matcher now works by SHAPE and
    // hands the semantics to a denylist, which inverts the failure — an unanticipated flag reads as
    // a creation and gets judged, so a mistake is a refusal someone sees rather than a hole nobody
    // learns about.
    ['the = form before a copy', 'git branch --track=direct -c a b'],
    ['bundled shorts before a copy', 'git branch -qf -c a b'],
    // The copy flag glued INTO a bundle. `-[cC]` demanded a boundary the next letter is not, so
    // these never reached the copy matcher and fell through to the CREATION path — which reads a
    // name and a base out of the positions the copy forms reverse. Measured: refused, but for the
    // wrong argument, which is the confident wrong answer that refusing-instead-of-parsing exists
    // to avoid.
    ['the copy flag glued after another', 'git branch -qc a b'],
    ['the copy flag glued before another', 'git branch -cq a b'],
    ['force and copy in one bundle', 'git branch -fc a b'],
  ];

  for (const [what, command] of COPY_SPELLINGS) {
    it(`refuses ${what}`, () => {
      const { status, said } = run(command);

      expect(status, said).toBe(2);
      // The message must name the prescribed form. A refusal that does not say what to do instead is
      // one the reader satisfies by reaching for the override.
      expect(said).toMatch(/git checkout -b/);
    });
  }

  it('matches flags by SHAPE, so no list can be missing one', () => {
    // The structural half of the finding above. Detection and extraction each held their own typed
    // copy of the flag list; a flag added to one and not the others reopens the same gap silently.
    // The list is defined once and interpolated, and this asserts the file still holds exactly one
    // literal spelling of it — the definition.
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../.claude/hooks/branch-guard.sh'),
      'utf8',
    );
    // The allowlist is GONE, and its absence is the property worth pinning: three separate bypasses
    // were a list missing a spelling, so a list is the thing that must not come back. What remains
    // is one shape pattern and one denylist, and the denylist's failure direction is a refusal.
    expect(source, 'the flag allowlist is back').not.toMatch(
      /-f\|--force\|-q\|--quiet\|-t\|--track\|--no-track/,
    );
    expect(source).toMatch(/RE_BRANCH_FLAG=/);
    expect(source).toMatch(/RE_BRANCH_NOT_CREATE=/);
  });

  it('takes its own deliberate exception', () => {
    expect(run('BRANCH_GUARD_ALLOW_BRANCH_COPY=1 git branch -c a b').status).toBe(0);
  });

  it('does not refuse the spellings that merely start with the same word', () => {
    // The copy matcher must not swallow the form this whole change exists to judge, nor the listing
    // forms it must leave alone.
    expect(run('git branch feat/ok origin/develop').status).toBe(0);
    expect(run('git branch --contains HEAD').status).toBe(0);
  });
});

describe('listing, deleting and renaming are not creations', () => {
  // Each proven SILENT, not merely permitted: a guard that narrates on the happy path is one people
  // learn to scroll past, after which its refusals scroll past too.
  const CREATIONS_BEHIND_AWKWARD_FLAGS = [
    ['the = form', 'git branch --track=direct feat/x main'],
    ['bundled shorts', 'git branch -qf feat/x main'],
  ];

  for (const [what, command] of CREATIONS_BEHIND_AWKWARD_FLAGS) {
    it(`judges a creation written with ${what}`, () => {
      const { status, said } = run(command);

      expect(status, said).toBe(2);
      expect(said).toMatch(/wrong base/);
    });
  }

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
    // These take a VALUE, so their argument sits exactly where a new branch's name would. Shape
    // matching alone read `-d old` as creating `old` and `--contains HEAD` as creating `HEAD` —
    // both measured refusing correct work before the denylist existed. This is the cost of the
    // fail-closed direction, and these cases are what keeps it paid.
    ['a forced rename', 'git branch -M BAD_NAME other'],
    ['listing by containment', 'git branch --contains HEAD'],
    ['listing merged branches with a value', 'git branch --merged origin/develop'],
    ['listing by pattern', 'git branch --list feat/*'],
    ['pointing at a ref', 'git branch --points-at HEAD'],
    // `git branch [-r|-a] [--list] [<pattern>...]` takes a PATTERN, which sits exactly where a new
    // branch's name goes. A comment in the hook used to claim these needed no denylist entry
    // "because nothing follows them" — an assertion about git's grammar made without reading it,
    // and `git branch -r origin/main` was refused on ordinary listing until review caught it.
    ['listing all refs by pattern', 'git branch -a release/x'],
    ['listing remotes by name', 'git branch -r origin/main'],
    ['the long form of both', 'git branch --all release/x'],
    ['verbose listing with a pattern', 'git branch -v feat/x'],
    // Bundled, like both create matchers already are. The denylist matched a single letter only, so
    // these were read as creations and refused — the third time in this change that a matcher was
    // written for one spelling while git accepts several. Same defect, other direction, and its
    // cost is a refusal on ordinary listing.
    ['bundled all-and-verbose with a pattern', 'git branch -av feature/x'],
    ['bundled remotes-and-verbose with a name', 'git branch -rv origin/main'],
    ['bundled delete', 'git branch -dr old'],
  ];

  for (const [what, command] of NOT_A_CREATION) {
    it(`${what} passes with no output`, () => {
      const { status, said } = run(command);

      expect(status, said).toBe(0);
      expect(said.trim(), `\`${command}\` spoke`).toBe('');
    });
  }
});
