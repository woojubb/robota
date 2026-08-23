import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_SRC = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * INFRA-079 (#1563) — the guard judges a command; every decision belongs to a STATEMENT.
 *
 * A Bash tool call is a sequence of statements and each guarded action belongs to exactly one of
 * them. `branch-guard.sh` collapsed that sequence twice: `IS_COMMIT`/`IS_PUSH`/`IS_MERGE`/
 * `IS_BRANCH_CREATE` were booleans over the WHOLE command, and `NEW_BRANCH`/`START_POINT`/
 * `DELETE_BRANCH_NAME` were single values taken from the FIRST match anywhere, because
 * `hook_match_extract` uses awk `match()`. One aggregate verdict then answered for N actions.
 *
 * Measured on `develop`, with a bare control refused correctly and NO override token in either:
 *
 *   git checkout -b feat/y main                                   -> exit 2
 *   git checkout -b feat/x develop ; git checkout -b feat/y main  -> exit 0   (wrong base unjudged)
 *   git checkout -b BAD_NAME                                      -> exit 2
 *   git checkout -b feat/ok ; git checkout -b BAD_NAME            -> exit 0   (bad name unjudged)
 *
 * This file states the property rather than the two shapes, because the two shapes are two
 * spellings of one defect and the next spelling is by definition not on a list:
 *
 *     A statement that is refused on its own is refused in any company.
 *
 * Every guarded command is proved refused bare, every sibling is proved permitted bare, and then the
 * cross product of the two over three separators must still refuse. The last section proves the
 * guard is not simply refusing everything: an override on the guarded statement itself excuses it,
 * and an override on a SIBLING does not.
 */

/**
 * A repository where `main` and `origin/develop` are DIFFERENT commits, checked out on a feature
 * branch whose HEAD is `origin/develop`.
 *
 * All three properties are load-bearing: without the divergence "cut from main" is not a wrong base
 * and the check has nothing to refuse; with HEAD elsewhere a creation with no start point would be
 * refused for its base rather than for its name; and on a protected branch an ordinary sibling
 * commit would be refused for a reason this file is not about.
 */
function scratchRepo() {
  const dir = makeTemp('bg-stmt-repo-');
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

/** The hooks tree, copied out of any worktree path, plus a `gh` that fails rather than reaching out. */
function hooksSandbox() {
  const dir = makeTemp('bg-stmt-hooks-');
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

function verdict(command) {
  const result = spawnSync('bash', [sandbox.hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }),
    encoding: 'utf8',
    cwd: repo,
    // Only PATH, HOME and the project dir. Every BRANCH_GUARD_ALLOW_* is absent by construction, so
    // nothing below can pass because the environment permitted it.
    env: {
      PATH: `${sandbox.bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      CLAUDE_PROJECT_DIR: repo,
    },
    timeout: 60_000,
  });
  return result.status ?? -1;
}

/** Refused on its own, and none of them carries an override token of any kind. */
const GUARDED = [
  ['a branch cut from the wrong base', 'git checkout -b feat/y main'],
  ['a branch name that breaks the convention', 'git checkout -b BAD_NAME'],
  ['a protected-branch delete', 'git push origin --delete develop'],
];

/** Permitted on its own. */
const SIBLINGS = [
  ['a correct creation', 'git checkout -b feat/ok develop'],
  ['a read-only git call', 'git status'],
  ['something that is not git at all', 'echo done'],
];

/**
 * `;`, `&&` and a NEWLINE. The newline is the one that matters most: it is the separator the
 * previous statement-splitting in this directory did not recognise, so a fix that closed only the
 * `;` spelling would have shipped the next hole with it.
 */
const SEPARATORS = [
  ['a semicolon', ' ; '],
  ['an and-list', ' && '],
  ['a newline', '\n'],
];

describe('a statement refused on its own is refused in any company (INFRA-079)', () => {
  it('refuses every guarded statement when it is written alone', () => {
    // The controls. Without these the cross product below is satisfied by a guard that refuses
    // everything, and with these it cannot be.
    const wrong = GUARDED.filter(([, command]) => verdict(command) !== 2).map(([name]) => name);
    expect(
      wrong,
      'a guarded command that is not refused bare proves nothing about company',
    ).toStrictEqual([]);
  });

  it('permits every sibling when it is written alone', () => {
    // And these. A sibling that is itself refused would make the cross product hold for the wrong
    // reason — the compound would be refused whatever the guard did with the guarded half.
    const wrong = SIBLINGS.filter(([, command]) => verdict(command) !== 0).map(([name]) => name);
    expect(
      wrong,
      'a sibling that is refused on its own is not a sibling, it is a second defect',
    ).toStrictEqual([]);
  });

  for (const [sepName, sep] of SEPARATORS) {
    it(`still refuses it behind a well-formed sibling, joined by ${sepName}`, () => {
      const escaped = [];
      for (const [guardedName, guarded] of GUARDED) {
        for (const [siblingName, sibling] of SIBLINGS) {
          // Both orders. The old reading took the FIRST match anywhere, so a guarded statement in
          // second position escaped and one in first position did not — testing one order would
          // have called the defect closed while half of it was live.
          if (verdict(`${sibling}${sep}${guarded}`) !== 2) {
            escaped.push(`${guardedName} AFTER ${siblingName}`);
          }
          if (verdict(`${guarded}${sep}${sibling}`) !== 2) {
            escaped.push(`${guardedName} BEFORE ${siblingName}`);
          }
        }
      }
      expect(
        escaped,
        'a guarded statement went unjudged because a sibling was well-formed. The verdict was ' +
          'about the command; every decision belongs to a statement.',
      ).toStrictEqual([]);
    });
  }
});

describe('an override excuses the statement it prefixes, and only that one (INFRA-079)', () => {
  it('excuses the guarded statement it prefixes', () => {
    // The guard is not refusing everything: written the way git-branch.md documents, the override
    // works, alone and beside a sibling.
    expect(verdict('BRANCH_GUARD_ALLOW_BASE=1 git checkout -b feat/y main')).toBe(0);
    expect(verdict('BRANCH_GUARD_ALLOW_BADNAME=1 git checkout -b BAD_NAME')).toBe(0);
    expect(
      verdict(
        'git checkout -b feat/ok develop ; BRANCH_GUARD_ALLOW_BASE=1 git checkout -b feat/y main',
      ),
    ).toBe(0);
    expect(
      verdict(
        'BRANCH_GUARD_ALLOW_BASE=1 git checkout -b feat/y main ; git checkout -b feat/ok develop',
      ),
    ).toBe(0);
  });

  it('does not let an override on one statement excuse another', () => {
    // The two cases #1559 closed with a counting invariant over the whole command. They stay closed
    // now that the subject is the statement — and they close for a reason rather than by a count.
    expect(
      verdict(
        'BRANCH_GUARD_ALLOW_BASE=1 git checkout -b feat/x main ; git checkout -b feat/y main',
      ),
    ).toBe(2);
    expect(
      verdict('BRANCH_GUARD_ALLOW_BADNAME=1 git checkout -b BAD_ONE ; git checkout -b BAD_TWO'),
    ).toBe(2);
    expect(
      verdict(
        'BRANCH_GUARD_ALLOW_DELETE=1 git push origin --delete scratch-1 ; git push origin --delete develop',
      ),
    ).toBe(2);
  });

  it('reads an override off the command, never off text inside it', () => {
    // The oldest spelling of this defect: a commit MESSAGE that merely names the token switched the
    // guard off. It is data, and the override is read from the masked statement.
    expect(
      verdict(
        'git commit -m "tried BRANCH_GUARD_ALLOW_DELETE=1" ; git push origin --delete develop',
      ),
    ).toBe(2);
  });
});
