import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * Two guards reading the same command must reach the same reading of it.
 *
 * These are not style findings. Both cases below were measured on `develop`, and each is a live
 * bypass of a gate that is otherwise working:
 *
 * - `branch-guard` ends a git verb at any non-word character; `pre-push-check`'s interception gate
 *   required whitespace or end-of-line. So `git push; …` was a push to one and not a push to the
 *   other — and since that gate is the whole file's entry point, the branch-hygiene check, the
 *   lockfile-sync check and the local-review record were all skipped for that shape. No fixture in
 *   the repository ended a command at `push`, which is why it survived.
 * - `worktree-cwd-guard` read its override token off the RAW command rather than the masked one, so
 *   a commit message that merely NAMED the override switched the guard off. `branch-guard` documents
 *   this exact attack and fixed it; the sibling hook never received the fix.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(branch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'boundary-'));
  scratch.push(dir);
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

function run(hook, command, dir, env = {}) {
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hook)], {
    input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }),
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    timeout: 120_000,
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('a push is a push to every guard that reads the command', () => {
  // The separator follows the verb. Every existing fixture writes `git push origin …`, so the
  // boundary after `push` itself had never been exercised.
  const SHAPES = ['git push;', 'git push; echo ok', 'git push|cat', '(git push)', 'git push&'];

  for (const command of SHAPES) {
    it(`pre-push-check sees a push in \`${command}\``, () => {
      const dir = scratchRepo('feat/probe');
      const verdict = run('pre-push-check.sh', command, dir);

      expect(
        verdict.status,
        'the push gate never engaged, so branch hygiene, lockfile sync and the review record were ' +
          `all skipped for this shape: ${verdict.output}`,
      ).toBe(2);
      expect(verdict.output).toMatch(/no local review recorded/);
    });
  }

  it('still says nothing about a command that is not a push', () => {
    // The other half: widening a boundary is how a guard starts firing on correct work.
    const dir = scratchRepo('feat/probe');
    const verdict = run('pre-push-check.sh', 'git pushd-something; echo ok', dir);

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });
});

describe('every branch-guard override is given, not merely mentioned', () => {
  // INFRA-076. The four `BRANCH_GUARD_ALLOW_*` tokens were read as a token ANYWHERE in the masked
  // command, so an unquoted mention disarmed them — the shape fixed in the sibling guard and never
  // ported here, because these were DOCUMENTED as loose.
  //
  // Measured before changing them: every documented usage is already the prefix form, and
  // `git-branch.md` says "inline in the same command". There was no loose usage to break.
  const OVERRIDES = [
    // On a feature branch: the protected-branch push rule would otherwise fire first and the case
    // would prove nothing about the delete override.
    {
      token: 'BRANCH_GUARD_ALLOW_DELETE',
      guarded: 'git push origin --delete feat/gone',
      on: 'feat/probe',
    },
    { token: 'BRANCH_GUARD_ALLOW_MAIN_MERGE', guarded: 'git merge develop', on: 'main' },
    { token: 'BRANCH_GUARD_ALLOW_BADNAME', guarded: 'git checkout -b BAD_NAME', on: 'develop' },
  ];

  it('an override on a harmless command does not excuse the guarded one', () => {
    // The decoy, ported from the sibling guard where it was already fixed and measured. Anchoring
    // the token to "some git call" is not enough: it must prefix the statement that carries the
    // command being overridden, or a `git status` in front becomes a skeleton key for the line.
    //
    // Reported as a PoC on this PR: `BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git status; git push origin
    // main` set the flag globally and the real push went unchecked.
    const decoys = [
      { on: 'main', command: 'BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git status; git push origin main' },
      { on: 'main', command: 'BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git log -1 && git merge develop' },
      {
        on: 'develop',
        command: 'BRANCH_GUARD_ALLOW_BADNAME=1 git status; git checkout -b BAD_NAME',
      },
    ];

    for (const { on, command } of decoys) {
      const dir = scratchRepo(on);
      expect(
        run('branch-guard.sh', command, dir).status,
        `an override on a harmless command excused: ${command}`,
      ).not.toBe(0);
    }
  });

  for (const { token, guarded, on } of OVERRIDES) {
    it(`${token} fires, resists a mention, and yields to the prefix`, () => {
      // Three ways in one case, so the fixture proves itself. Asserting only "the mention was
      // blocked" passes whenever the guard blocks for ANY reason — including a fixture that never
      // reached the check at all, which is the accidental-green shape this suite exists against.
      const dir = scratchRepo(on);
      const bare = run('branch-guard.sh', guarded, dir);
      const mention = run('branch-guard.sh', `echo ${token}=1 ; ${guarded}`, dir);
      const prefix = run('branch-guard.sh', `${token}=1 ${guarded}`, dir);

      expect(
        bare.status,
        `the guard never fired here, so this case proves nothing: ${bare.output}`,
      ).not.toBe(0);
      expect(mention.status, `a bare mention of ${token} disarmed the guard`).not.toBe(0);
      expect(prefix.status, `the documented prefix form was refused: ${prefix.output}`).toBe(0);
    });
  }
});

describe('an override must be given, not merely mentioned', () => {
  function worktreeRun(command) {
    const dir = scratchRepo('feat/probe');
    return run('worktree-cwd-guard.sh', command, dir, {
      ROBOTA_AGENT_WORKTREE: '/repo/.claude/worktrees/agent-x',
    });
  }

  it('refuses a destructive command whose message only NAMES the override', () => {
    // Measured on develop: allowed. The token was read off the raw command, so any quoted mention
    // disarmed the guard — the attack `branch-guard` documents at its own override, never ported.
    const verdict = worktreeRun(
      'git commit -m "note: WORKTREE_CWD_GUARD_ALLOW_MAIN=1 was tried" && git reset --hard',
    );

    expect(
      verdict.status,
      'a quoted mention of the override switched the guard off for a reset --hard on the main clone',
    ).toBe(2);
  });

  it('refuses when the token is merely a word in the command', () => {
    // The shape that actually gets through. A quoted mention is masked and already refused; an
    // UNQUOTED one is a real word in the command, and the loose token rule honoured it wherever it
    // appeared. Both of these were allowed:
    //   git commit -m WORKTREE_CWD_GUARD_ALLOW_MAIN=1 && git reset --hard
    //   echo WORKTREE_CWD_GUARD_ALLOW_MAIN=1 ; git reset --hard
    // The fix is positional, not lexical: an override is something you GIVE the command, so it must
    // prefix it — which is what the hook's own refusal message has always told the operator to do.
    for (const command of [
      'git commit -m WORKTREE_CWD_GUARD_ALLOW_MAIN=1 && git reset --hard',
      'echo WORKTREE_CWD_GUARD_ALLOW_MAIN=1 ; git reset --hard',
    ]) {
      expect(worktreeRun(command).status, `a bare mention disarmed the guard: ${command}`).toBe(2);
    }
  });

  it('refuses when the override prefixes a DIFFERENT command', () => {
    // The decoy. `WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git status && git reset --hard` puts the token on
    // a harmless call; a check that asks only "does the token prefix SOME git call" matches, exits
    // 0, and the destructive command that follows is never judged at all. An override is given to
    // ONE command — the one it precedes — not to everything after it on the line.
    for (const command of [
      'WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git status && git reset --hard',
      'WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git log -1; git clean -fdx',
    ]) {
      expect(worktreeRun(command).status, `a decoy override let this through: ${command}`).toBe(2);
    }
  });

  it('still honours the override when it is actually given', () => {
    // Including behind another assignment, which is how a real invocation often looks.
    for (const command of [
      'WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git reset --hard origin/develop',
      'FOO=1 WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git reset --hard origin/develop',
    ]) {
      const verdict = worktreeRun(command);
      expect(verdict.status, `${command}: ${verdict.output}`).toBe(0);
    }
  });
});

describe('an override names an action, not a string that contains one', () => {
  // Review of #1559, both halves reproduced on a scratch repo before the fix. `override_given`'s
  // verb patterns were written fresh instead of reusing the ones the file already uses to DETECT
  // each action, so they forked in both directions at once: too loose at the end (no trailing
  // boundary, so `merge-base` read as `merge`) and too strict in the middle (no room for an
  // intervening flag, so the documented `git checkout -q -b x` stopped registering).
  //
  // The fork is the defect. One expression per action now serves both the detector and the
  // override, which is why these two cases sit together.

  it('a substring of the guarded verb does not excuse the guarded verb', () => {
    const decoys = [
      {
        on: 'main',
        command: 'BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git merge-base develop main ; git merge develop',
      },
      {
        on: 'main',
        command: 'BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git commit-tree -h ; git push origin main',
      },
      {
        on: 'develop',
        command: 'BRANCH_GUARD_ALLOW_BADNAME=1 git checkout -bogus ; git checkout -b BAD_NAME',
      },
    ];
    for (const { on, command } of decoys) {
      const dir = scratchRepo(on);
      expect(
        run('branch-guard.sh', command, dir).status,
        `a read-only plumbing command stood in for the guarded one: ${command}`,
      ).not.toBe(0);
    }
  });

  it('the documented override still registers with the flags git actually accepts', () => {
    // Fails CLOSED, so nothing was at risk — but a guard that refuses a form its own rule document
    // tells people to use is a guard people learn to route around.
    const allowed = [
      { on: 'develop', command: 'BRANCH_GUARD_ALLOW_BADNAME=1 git checkout -q -b BAD_NAME' },
      { on: 'develop', command: 'BRANCH_GUARD_ALLOW_BADNAME=1 git checkout -B BAD_NAME' },
      { on: 'develop', command: 'BRANCH_GUARD_ALLOW_BADNAME=1 git switch -C BAD_NAME' },
    ];
    for (const { on, command } of allowed) {
      const dir = scratchRepo(on);
      const { status, output } = run('branch-guard.sh', command, dir);
      expect(status, `the documented override was refused: ${output}`).toBe(0);
    }
  });

  it('proves the cases above are not vacuous', () => {
    // Without this, `not.toBe(0)` above passes when the guard blocks for ANY reason, and `toBe(0)`
    // passes when the guard never fires at all.
    const dir = scratchRepo('develop');
    expect(
      run('branch-guard.sh', 'git checkout -q -b BAD_NAME', dir).status,
      'the guard does not fire on the bare command, so the override cases prove nothing',
    ).not.toBe(0);
  });
});

describe('an override covers the statements it was given to, and no others', () => {
  // Depth verdict on #1559. The override became statement-scoped; the ACTION detection did not.
  // `IS_PUSH`/`IS_MERGE`/`IS_BRANCH_CREATE` are booleans over the WHOLE command, and the decision
  // at the bottom reads one global override flag — so one overridden statement answered for every
  // sibling statement of any guarded kind.
  //
  // The sibling guard reached the correct shape first and this file did not take it: count the
  // guarded statements, count the overridden ones, and honour the override only when every guarded
  // statement carries it (worktree-cwd-guard.sh, "DESTRUCTIVE_STATEMENTS == OVERRIDDEN_STATEMENTS").

  it('an overridden statement does not excuse an un-overridden sibling', () => {
    const cases = [
      {
        on: 'main',
        // Measured as newly reachable ON THIS BRANCH: develop refuses it only because the inline
        // form of this token was dead there. Making a dead override live over whole-command
        // detection is what opened it.
        command: 'BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git merge develop ; git push origin main',
        control: 'git push origin main',
      },
      {
        on: 'develop',
        // The delete path, whose own comment records that it once closed an unmerged PR.
        command:
          'BRANCH_GUARD_ALLOW_DELETE=1 git push origin --delete scratch-1 ; git push origin --delete develop',
        control: 'git push origin --delete develop',
      },
    ];
    for (const { on, command, control } of cases) {
      const bare = scratchRepo(on);
      expect(
        run('branch-guard.sh', control, bare).status,
        `the control is not blocked, so the case proves nothing: ${control}`,
      ).not.toBe(0);

      const dir = scratchRepo(on);
      expect(
        run('branch-guard.sh', command, dir).status,
        `one overridden statement excused an un-overridden sibling: ${command}`,
      ).not.toBe(0);
    }
  });

  it('an override still covers a command whose guarded statements all carry it', () => {
    // The other direction, and the reason the rule is "every guarded statement carries it" rather
    // than "no sibling exists": a guard that refuses correctly-overridden work gets switched off.
    const dir = scratchRepo('main');
    const { status, output } = run(
      'branch-guard.sh',
      'BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git merge develop ; BRANCH_GUARD_ALLOW_MAIN_MERGE=1 git push origin main',
      dir,
    );
    expect(status, `a fully-overridden command was refused: ${output}`).toBe(0);
  });
});

describe('a gate cannot be skipped by asking git to skip it', () => {
  // INFRA-083. Four parallel agents pushed with `--no-verify` in one day. The cause was fixed
  // (HARNESS-058: the gate could not go green in a worktree) and the agents were TOLD not to bypass —
  // and being told is not a mechanism. `--no-verify` skips the git-level hook, so the pre-push hook
  // cannot catch its own bypass; the PreToolUse layer runs on the TOOL CALL and is the one place the
  // flag cannot reach.
  //
  // Zero exceptions, matching the `gh pr merge --delete-branch` ban already in this file: an
  // override for an override is the next bypass. If a gate is wrong, the gate is what changes.

  it('refuses to skip the commit hooks', () => {
    const dir = scratchRepo('feat/probe');
    for (const command of [
      'git commit --no-verify -m "x"',
      'git commit -n -m "x"',
      'git commit -nm "x"',
      'git commit -am "x" --no-verify',
      // AFTER a substitution, on the same invocation. Truncating the argument list at the first
      // `$(` — to keep an inner command's flags out — threw away this invocation's own later flags
      // with them, and opened the bypass the whole change exists to close. (#1588 review)
      'git commit -m "$(git log -n 1)" --no-verify',
      'git push origin "$(git branch --show-current)" --no-verify',
      'git commit -m "$(date)" -n',
      'echo ok && git commit --no-verify -m "x"',
    ]) {
      expect(
        run('branch-guard.sh', command, dir).status,
        `a commit skipped its hooks: ${command}`,
      ).not.toBe(0);
    }
  });

  it('refuses every OTHER way to disable the hooks, not just the flag', () => {
    // The first version of this ban closed ONE spelling. Measured immediately after: six other
    // routes walked straight through — which is the instance-not-class mistake this file's own
    // history is full of.
    //
    // The set is small and each member is documented by the tool it belongs to: git publishes
    // `core.hooksPath`, husky publishes its `HUSKY=0` kill switch. None has a legitimate agent use.
    const dir = scratchRepo('feat/probe');
    for (const command of [
      'HUSKY=0 git push origin feat/probe',
      'HUSKY=0 git commit -m "x"',
      'git -c core.hooksPath=/dev/null push origin feat/probe',
      'git -c core.hooksPath=/dev/null commit -m "x"',
      'git config core.hooksPath /dev/null',
      'rm .husky/pre-push',
      'echo "" > .husky/pre-commit',
      'chmod -x .husky/pre-push',
      // The DIRECTORY forms — the most natural way anyone would actually do it, and the ones the
      // first version missed because its pattern demanded a trailing `/`. The test missed them for
      // the same reason, so the gap shipped green: a defect-fix test that passes on the defect.
      'rm -rf .husky',
      'mv .husky /tmp',
      'chmod -R -x .husky',
      'rm -r ./.husky',
      // Emptying a hook without `rm`, `>` or `chmod`. The rule doc says "zero exceptions"; these
      // were as common as the covered ones, so the claim overstated the coverage until now.
      'cp /dev/null .husky/pre-push',
      'truncate -s0 .husky/pre-push',
      'find .husky -delete',
      'find .husky -type f -exec rm {} +',
    ]) {
      expect(
        run('branch-guard.sh', command, dir).status,
        `a hook kill switch was allowed: ${command}`,
      ).not.toBe(0);
    }
  });

  it('leaves ordinary work with those words in it alone', () => {
    // A guard that fires on correct work gets switched off, and these are the shapes that would.
    const dir = scratchRepo('feat/probe');
    for (const command of [
      'git config user.email a@b.c',
      'cat .husky/pre-push',
      'ls .husky',
      'echo "HUSKY=0 is banned"',
      'git -c core.editor=true commit -m "x"',
      // Review of #1588: a substitution's content is deliberately NOT masked — it runs — so an
      // inner `-n` belonging to a DIFFERENT command was read as the outer commit's skip-hooks flag.
      // These are ordinary commits that never name the flag at all.
      'git commit -m "$(git log -n 1 --format=%s)"',
      'git commit -m "$(grep -n TODO file.txt)"',
      'git commit -F - <<EOF\nsee git log -n 1\nEOF',
      // The rule says "reading, listing and EDITING a hook are untouched; only destroying one is
      // refused" — and the readers-only whitelist contradicted its own statement for these two.
      // Restoring an executable bit and editing a hook in place are not bypasses. (#1588 review)
      'chmod +x .husky/pre-push',
      'sed -i "s/foo/bar/" .husky/pre-push',
    ]) {
      const { status, output } = run('branch-guard.sh', command, dir);
      expect(status, `ordinary work was refused: ${command} -> ${output}`).toBe(0);
    }
  });

  it('refuses to skip the push hooks', () => {
    const dir = scratchRepo('feat/probe');
    for (const command of ['git push --no-verify', 'git push origin feat/probe --no-verify']) {
      expect(
        run('branch-guard.sh', command, dir).status,
        `a push skipped its hooks: ${command}`,
      ).not.toBe(0);
    }
  });

  it('leaves the ordinary forms alone, and `git push -n` is a DRY RUN', () => {
    // Measured, not assumed: `git push -h` documents `-n` as `--dry-run`, while `git commit -h`
    // documents `-n` as `--no-verify`. Refusing `git push -n` would refuse a harmless rehearsal —
    // the same short flag meaning two different things in two subcommands.
    const dir = scratchRepo('feat/probe');
    for (const command of [
      'git push -n',
      'git push --dry-run',
      'git commit -am "x"',
      'git commit -m "x"',
      'git push origin feat/probe',
    ]) {
      const { status, output } = run('branch-guard.sh', command, dir);
      expect(status, `ordinary work was refused: ${command} -> ${output}`).toBe(0);
    }
  });

  it('is not disarmed by the flag sitting inside a quoted message', () => {
    // The masker's whole job. A commit whose MESSAGE discusses the flag is prose, not a bypass.
    const dir = scratchRepo('feat/probe');
    const { status, output } = run(
      'branch-guard.sh',
      'git commit -m "note: --no-verify is banned"',
      dir,
    );
    expect(status, `a quoted mention was read as the flag: ${output}`).toBe(0);
  });
});

describe('a hook cannot be emptied through the Edit tool either', () => {
  // The Bash guard covers commands. It cannot cover the tool an agent would actually reach for:
  // Write/Edit/MultiEdit change file CONTENT without running a command at all, so `.husky/pre-commit`
  // could simply be replaced with an empty body. Claiming "zero exceptions" for hook destruction
  // while that door is open would be a claim, not a gate. (#1588 review)
  const FORBIDDEN = path.join(HOOKS_DIR, 'check-forbidden-patterns.sh');

  function runTool(payload) {
    const result = spawnSync('bash', [FORBIDDEN], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeout: 120_000,
    });
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('refuses a Write or Edit that guts a husky hook', () => {
    const cases = [
      { tool_name: 'Write', tool_input: { file_path: '/r/.husky/pre-commit', content: '' } },
      {
        tool_name: 'Write',
        tool_input: { file_path: '/r/.husky/pre-push', content: '#!/bin/sh\n' },
      },
      {
        tool_name: 'Edit',
        tool_input: { file_path: '/r/.husky/pre-commit', new_string: '', old_string: 'x' },
      },
      {
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: '/r/.husky/pre-push',
          edits: [{ new_string: '', old_string: 'x' }],
        },
      },
    ];
    for (const payload of cases) {
      expect(
        runTool(payload).status,
        `a husky hook was gutted through ${payload.tool_name}`,
      ).not.toBe(0);
    }
  });

  it('leaves a real hook edit, and every other file, alone', () => {
    // A hook that GAINS content is ordinary maintenance — this session edited `.husky/pre-commit`
    // to add the cross-worktree lock. Refusing that would make the guard unusable.
    const ok = [
      {
        tool_name: 'Edit',
        tool_input: {
          file_path: '/r/.husky/pre-commit',
          old_string: 'pnpm exec lint-staged',
          new_string: 'with-repo-lock.sh pnpm exec lint-staged',
        },
      },
      { tool_name: 'Write', tool_input: { file_path: '/r/src/index.ts', content: '' } },
    ];
    for (const payload of ok) {
      const { status, output } = runTool(payload);
      expect(
        status,
        `ordinary work was refused: ${JSON.stringify(payload.tool_input)} -> ${output}`,
      ).toBe(0);
    }
  });
});
