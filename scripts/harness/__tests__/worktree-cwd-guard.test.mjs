import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

// The hook under test — a PreToolUse Bash guard that blocks destructive git commands when a
// worktree-assigned subagent's cwd has silently fallen back to the MAIN checkout (HARNESS-043).
import { hooksOutsideAWorktree } from './helpers/hooks-outside-a-worktree.mjs';

// Not the checkout's own copy: this hook reads its OWN directory to decide whether the session is
// a worktree one, so spawning it from wherever the suite happens to run makes that input
// uncontrolled and the main-clone fixtures below unreachable. See the helper.
const HOOK = path.join(hooksOutsideAWorktree(), 'worktree-cwd-guard.sh');

const cleanupDirs = [];
afterAll(() => {
  while (cleanupDirs.length > 0) rmSync(cleanupDirs.pop(), { recursive: true, force: true });
});

/** git init a repo at `dir` (created if needed) with an initial commit so rev-parse resolves. */
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      stdio: 'pipe',
    });
  git('init', '-q');
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-q', '-m', 'init'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
    stdio: 'pipe',
  });
  return dir;
}

/** Run the hook with a synthesized PreToolUse payload; returns { status, stderr }. */
function runHook({ command, cwd, env = {} }) {
  const payload = JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command },
    cwd,
  });
  const res = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    // Start from a scrubbed env so the marker is only present when a case sets it.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { status: res.status, stderr: res.stderr ?? '' };
}

let root;
let mainRepo;
let worktreeRepo;

beforeAll(() => {
  root = makeTemp('wt-cwd-guard-');
  // MAIN checkout — its toplevel path does NOT contain `.claude/worktrees/`.
  mainRepo = initRepo(path.join(root, 'mainrepo'));
  // Assigned worktree — its toplevel path DOES contain `.claude/worktrees/`.
  worktreeRepo = initRepo(path.join(root, 'mainrepo', '.claude', 'worktrees', 'agent-test'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('worktree-cwd-guard hook', () => {
  it('BLOCKS git reset --hard when cwd fell back to MAIN and a worktree marker is set', () => {
    const { status, stderr } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
    expect(stderr).toMatch(/worktree-cwd-guard/);
  });

  it('BLOCKS git clean -fdx in the same fallback context', () => {
    const { status } = runHook({
      command: 'git clean -fdx',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('BLOCKS git checkout -- . in the same fallback context', () => {
    const { status } = runHook({
      command: 'git checkout -- .',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('BLOCKS git push --force in the same fallback context', () => {
    const { status } = runHook({
      command: 'git push --force origin main',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(2);
  });

  it('ALLOWS the same destructive command inside the assigned worktree', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: worktreeRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('ALLOWS a destructive command with the inline override token', () => {
    const { status } = runHook({
      command: 'WORKTREE_CWD_GUARD_ALLOW_MAIN=1 git reset --hard origin/develop',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('does not affect non-destructive git in the fallback context', () => {
    const { status } = runHook({
      command: 'git status --short',
      cwd: mainRepo,
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('FAIL-SAFE: normal main-repo destructive work with NO worktree marker is unaffected', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: mainRepo,
      env: {},
    });
    expect(status).toBe(0);
  });

  it('FAIL-SAFE: does not block when the effective dir cannot be resolved as a git repo', () => {
    const { status } = runHook({
      command: 'git reset --hard origin/develop',
      cwd: path.join(root, 'not-a-repo'),
      env: { ROBOTA_AGENT_WORKTREE: worktreeRepo },
    });
    expect(status).toBe(0);
  });

  it('ignores non-Bash tool calls', () => {
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: {}, cwd: mainRepo });
    const res = spawnSync('bash', [HOOK], { input: payload, encoding: 'utf8' });
    expect(res.status).toBe(0);
  });
});

/**
 * A harness audit RAN the hook over these and got exit 0 for every one. The `-C` was read from the
 * WHOLE command — first match anywhere — and the four destructive rules were written out twice with
 * different windows between the tokens, so a flag a rule did not spell was a flag it did not see.
 *
 * Each case below was measured against the pre-fix hook before it was written. `git -C <worktree>`
 * cases had no coverage at all: the file had ZERO `git -C` cases.
 */
describe('a destructive statement is judged against its OWN repository', () => {
  const inWorktreeSession = () => ({ ROBOTA_AGENT_WORKTREE: worktreeRepo });

  it('BLOCKS a reset whose sibling statement carries the only `git -C`', () => {
    // Pre-fix: exit 0. The harmless `-C <worktree>` resolved for the whole command, so the reset —
    // which runs in the MAIN cwd — was judged against the worktree and allowed.
    const { status } = runHook({
      command: `git -C ${worktreeRepo} status && git reset --hard`,
      cwd: mainRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(2);
  });

  it('BLOCKS a reset that names MAIN via `-C` behind a worktree `-C`', () => {
    // Pre-fix: exit 0, and this is the worse half — the destructive statement names the main
    // checkout OUTRIGHT and was still waved through by the statement in front of it.
    const { status } = runHook({
      command: `git -C ${worktreeRepo} status && git -C ${mainRepo} reset --hard`,
      cwd: mainRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(2);
  });

  it('ALLOWS a reset in the worktree when a sibling statement reads MAIN', () => {
    // The same defect refusing correct work: pre-fix this was exit 2, because the `-C <main>` on a
    // read-only `log` spoke for a reset aimed at the worktree the session is actually in. A guard
    // that both misses the hazard and blocks correct work is not conservative.
    const { status } = runHook({
      command: `git -C ${mainRepo} log -1 && git reset --hard`,
      cwd: worktreeRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(0);
  });

  it('ALLOWS a destructive statement that names the worktree via `-C` from MAIN', () => {
    const { status } = runHook({
      command: `git -C ${worktreeRepo} reset --hard`,
      cwd: mainRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(0);
  });
});

describe('a flag is judged by what git accepts, not by how the rule was spelt', () => {
  const inWorktreeSession = () => ({ ROBOTA_AGENT_WORKTREE: worktreeRepo });

  it('BLOCKS `git push -f`', () => {
    // Pre-fix: exit 0. The rule was literally `push\b[^|;&]*--force`, while the `clean` rule two
    // lines above it WAS bundle-aware — the two were written separately and only one learned.
    const { status } = runHook({
      command: 'git push -f origin develop',
      cwd: mainRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(2);
  });

  it('BLOCKS a force push in every long spelling', () => {
    for (const flag of ['--force', '--force-with-lease', '--force-if-includes']) {
      const { status } = runHook({
        command: `git push ${flag} origin develop`,
        cwd: mainRepo,
        env: inWorktreeSession(),
      });
      expect(status, flag).toBe(2);
    }
  });

  it('BLOCKS a destructive flag separated from its verb by a REDIRECT', () => {
    // Pre-fix: exit 0 for both. `2>&1` is a word between the subcommand and its flag, and the
    // windowed regexes stopped before it.
    for (const command of ['git clean 2>&1 -fd', 'git reset 2>&1 --hard']) {
      const { status } = runHook({ command, cwd: mainRepo, env: inWorktreeSession() });
      expect(status, command).toBe(2);
    }
  });

  it('BLOCKS a reset that runs inside a substitution', () => {
    // `echo "$(git reset --hard)"` RESETS. RAN against the pre-fix hook: already exit 2 — this is
    // a property the rewrite had to KEEP, not a hole it closed, and it is the reason the word list
    // is the substitution-INCLUDING one. Measured both readings: `hook_statement_words` returns
    // `echo|""` here and would have lost the case silently.
    const { status } = runHook({
      command: 'echo "$(git reset --hard)"',
      cwd: mainRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(2);
  });

  it('BLOCKS a destructive command with a git SUBSTITUTION among its arguments', () => {
    // Review found this in the first version of the word-list judgement, which tracked "the verb of
    // the invocation being read" and reset it at every `git` token. `hook_statement_all_words`
    // flattens a substitution into the SAME word stream, and an unquoted one leaves no boundary:
    //
    //   git reset $(git rev-parse HEAD~1) --hard  ->  git|reset|git|rev-parse|HEAD~1|--hard
    //
    // The nested `git` cleared the verb, `rev-parse` was adopted instead, and `--hard` matched
    // nothing. RAN against that version: exit 0 for both of these.
    //
    // There is no way to tell that nested `git` from a sequential one at this level, so the verb is
    // now a property of the STATEMENT rather than of an invocation inside it.
    for (const command of [
      'git reset $(git rev-parse HEAD~1) --hard',
      'git push $(git remote) -f main',
    ]) {
      const { status } = runHook({ command, cwd: mainRepo, env: inWorktreeSession() });
      expect(status, command).toBe(2);
    }
  });

  it('does not read an `f` inside a short option VALUE as force', () => {
    // Review supplied both: `git push -octi.skip=false` is `-o` (push-option) whose VALUE happens
    // to contain an `f`, and `git clean -e*.conf` is `-e` (exclude) the same way. The bundle test
    // was `*f*` over the whole token, so both read as force and ordinary work was refused — the
    // firing-on-correct-work that gets a guard turned off. The bundle is now read only up to the
    // first value-taking letter.
    for (const command of ['git push -octi.skip=false origin develop', 'git clean -e*.conf -n']) {
      const { status } = runHook({ command, cwd: mainRepo, env: inWorktreeSession() });
      expect(status, command).toBe(0);
    }
  });

  it('still reads an `f` that stands BEFORE the value-taking letter', () => {
    // `-fo…` is force plus an option; only what FOLLOWS `o`/`e` is a value.
    const { status } = runHook({
      command: 'git push -fociao origin develop',
      cwd: mainRepo,
      env: inWorktreeSession(),
    });

    expect(status).toBe(2);
  });

  it('leaves a commit message that MENTIONS a force push alone', () => {
    // The false positive the whole word-list approach is judged on. Quoted content is hidden by the
    // tokenizer, so this builds `git|commit|-m|""` and is not a force push.
    const { status } = runHook({
      command: 'git commit -m "do not git push -f"',
      cwd: mainRepo,
      env: inWorktreeSession(),
    });
    expect(status).toBe(0);
  });

  it('leaves non-destructive flags that merely contain the letters alone', () => {
    for (const command of [
      'git push --follow-tags origin develop',
      'git clean -n',
      'git push -u origin develop',
    ]) {
      const { status } = runHook({ command, cwd: mainRepo, env: inWorktreeSession() });
      expect(status, command).toBe(0);
    }
  });
});

describe('worktree-cwd-guard: the two accidents that leave no trace', () => {
  // Both of these were recurring, and both were silent at the moment they happened. Written here
  // rather than in a new file because they are the same guard's subject — a second file would fork
  // the vocabulary of "what a worktree hazard is", which this repo has already paid for once.

  it('BLOCKS a git command whose ambient GIT_DIR names a DIFFERENT repository', () => {
    // Git hooks export GIT_DIR, and it outranks the working directory. A process that inherited one
    // wrote to the repository it was invoked FROM rather than the one it stood in — which overwrote
    // a shared branch with fixture commits. Every command involved looked local.
    //
    // The fixture points at a REAL other repository, because a GIT_DIR naming nothing is not this
    // incident: git fails loudly on its own there, and a case built on it would have passed for a
    // reason that has nothing to do with the check.
    const elsewhere = initRepo(path.join(root, 'another-clone'));

    const { status, stderr } = runHook({
      command: 'git commit -m "ordinary work"',
      cwd: mainRepo,
      env: { GIT_DIR: path.join(elsewhere, '.git') },
    });

    expect(status).toBe(2);
    expect(stderr).toMatch(/DIFFERENT repository/);
  });

  it('BLOCKS the PATH-QUALIFIED spelling of the same command', () => {
    // The gate's own trigger required a BARE `git` token, so `/usr/bin/git reset --hard` — the
    // spelling someone reaching around an alias or a shim actually uses — skipped the whole
    // ambient comparison while the comment above it promised "any git command at all". Review
    // found the contradiction; the trigger now accepts a path segment that ENDS in `git`.
    const elsewhere = initRepo(path.join(root, 'another-clone-for-path'));

    const { status, stderr } = runHook({
      command: '/usr/bin/git commit -m "ordinary work"',
      cwd: mainRepo,
      env: { GIT_DIR: path.join(elsewhere, '.git') },
    });

    expect(status, 'the path-qualified git skipped the ambient gate').toBe(2);
    expect(stderr).toMatch(/DIFFERENT repository/);
  });

  it('does not refuse a NON-git command when the ambient list is unreadable', () => {
    // The list load ran on every Bash call and its fail-closed refusal with it, so a checkout
    // where git-ambient-env.json does not exist yet — a worktree cut from an older commit —
    // refused `ls` and `npm test` in every session. Review scoped it: fail-closed is this check's
    // rule, but its subject is GIT commands, and a refusal wider than the subject is an outage.
    // The hook copy runs from a directory with no list beside it and no project dir to fall back
    // to, so the load fails — and a non-git command must not care.
    const bare = makeTemp('no-ambient-list-');
    cleanupDirs.push(bare);
    mkdirSync(path.join(bare, 'hooks'), { recursive: true });
    cpSync(path.dirname(HOOK), path.join(bare, 'hooks'), { recursive: true });

    const run = (command) =>
      spawnSync('bash', [path.join(bare, 'hooks', 'worktree-cwd-guard.sh')], {
        input: JSON.stringify({ tool_name: 'Bash', cwd: bare, tool_input: { command } }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: bare },
      });

    expect(run('ls -la').status, 'a non-git command was refused for a missing git list').toBe(0);
    // A GIT command with no readable list still refuses: the check has a subject it cannot judge.
    expect(run('git status').status, 'a git command passed with no subject list').toBe(2);
  });

  it('PERMITS a GIT_DIR naming the SAME repository', () => {
    // The variable being present is ordinary — git sets it whenever it runs a hook — and this guard
    // is built for that: it asks its own questions through a scrubbed environment. Refusing on
    // presence alone fires on the normal case, which is what gets a guard turned off.
    const { status } = runHook({
      command: 'git commit -m "ordinary work"',
      cwd: mainRepo,
      env: { GIT_DIR: path.join(mainRepo, '.git') },
    });

    expect(status).toBe(0);
  });

  it('leaves an ordinary git command alone when the environment is clean', () => {
    // Without this the case above would pass against a guard that blocked every git command, which
    // is not a guard — it is an outage.
    const { status } = runHook({ command: 'git commit -m "ordinary work"', cwd: mainRepo });

    expect(status).toBe(0);
  });

  it('BLOCKS a compound command whose checkout targets a branch another worktree holds', () => {
    // A checkout git refuses is harmless alone. In a compound command it is not: the statements
    // AFTER it still run, against whatever branch is actually checked out. A `reset --hard` meant
    // for one branch landed on another exactly this way.
    const held = 'held-by-a-sibling';
    execFileSync('git', ['-C', mainRepo, 'branch', held], { stdio: 'pipe' });
    const sibling = path.join(root, 'sibling-worktree');
    execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', sibling, held], {
      stdio: 'pipe',
    });

    try {
      const { status, stderr } = runHook({
        command: `git checkout ${held}; git reset --hard origin/develop`,
        cwd: mainRepo,
      });

      expect(status).toBe(2);
      expect(stderr).toMatch(/checked out in another worktree/);
    } finally {
      execFileSync('git', ['-C', mainRepo, 'worktree', 'remove', '--force', sibling], {
        stdio: 'pipe',
      });
    }
  });

  it('leaves a BARE checkout of that branch alone', () => {
    // git's own refusal is the whole outcome when nothing follows it. Blocking here would be the
    // guard firing on correct work, which is what gets a guard turned off.
    const held = 'held-by-a-sibling-2';
    execFileSync('git', ['-C', mainRepo, 'branch', held], { stdio: 'pipe' });
    const sibling = path.join(root, 'sibling-worktree-2');
    execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', sibling, held], {
      stdio: 'pipe',
    });

    try {
      const { status } = runHook({ command: `git checkout ${held}`, cwd: mainRepo });

      expect(status).toBe(0);
    } finally {
      execFileSync('git', ['-C', mainRepo, 'worktree', 'remove', '--force', sibling], {
        stdio: 'pipe',
      });
    }
  });
});

describe('worktree-cwd-guard: what review found the first version missing', () => {
  const held = 'held-for-review-cases';
  // A SECOND, unrelated repository with its own held branch in its own sibling worktree. Without
  // one, a `git -C <path>` case can only point back at `mainRepo` — which is what the case review
  // called out did, so the wrong-repository lookup it was written for could not be observed.
  const otherHeld = 'held-in-the-other-repo';
  const otherFree = 'free-in-the-other-repo';
  let sibling;
  let otherRepo;
  let otherSibling;

  beforeAll(() => {
    execFileSync('git', ['-C', mainRepo, 'branch', held], { stdio: 'pipe' });
    sibling = path.join(root, 'sibling-review');
    execFileSync('git', ['-C', mainRepo, 'worktree', 'add', '-q', sibling, held], {
      stdio: 'pipe',
    });

    otherRepo = initRepo(path.join(root, 'otherrepo'));
    execFileSync('git', ['-C', otherRepo, 'branch', otherHeld], { stdio: 'pipe' });
    execFileSync('git', ['-C', otherRepo, 'branch', otherFree], { stdio: 'pipe' });
    otherSibling = path.join(root, 'other-sibling');
    execFileSync('git', ['-C', otherRepo, 'worktree', 'add', '-q', otherSibling, otherHeld], {
      stdio: 'pipe',
    });
  });

  afterAll(() => {
    execFileSync('git', ['-C', mainRepo, 'worktree', 'remove', '--force', sibling], {
      stdio: 'pipe',
    });
    execFileSync('git', ['-C', otherRepo, 'worktree', 'remove', '--force', otherSibling], {
      stdio: 'pipe',
    });
  });

  it('BLOCKS a compound command joined by a NEWLINE', () => {
    // This file already says, twenty lines above the check, that a newline is a separator too — and
    // the check re-derived the reading anyway and came out worse. A destructive command on a later
    // LINE is the shape the guard exists for.
    const { status } = runHook({
      command: `git checkout ${held}\ngit reset --hard origin/develop`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('BLOCKS a checkout reached through `git -C`', () => {
    // `-C` pointing at another repository is not an edge case: it is how one worktree reaches into
    // another. Both other matchers in this file tolerate it explicitly; this one did not.
    const { status } = runHook({
      command: `git -C ${mainRepo} checkout ${held}; git status`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('BLOCKS a checkout that reaches the held branch through a CREATE flag', () => {
    // The extraction regex took the token immediately after `checkout`/`switch`, so a flag in front
    // of the name ended the match at a `-` and the block was skipped entirely. RAN against the
    // pre-fix hook: exit 0 for both.
    //
    // git refuses `-B`/`-c` onto a branch another worktree holds exactly as it refuses a plain
    // checkout — moving HEAD to that ref is what is blocked — so this is the hazard verbatim: the
    // checkout fails and `reset --hard` lands on whatever branch is actually checked out.
    for (const command of [
      `git checkout -B ${held}; git reset --hard`,
      `git switch -c ${held}; git reset --hard`,
    ]) {
      const { status } = runHook({ command, cwd: mainRepo });
      expect(status, command).toBe(2);
    }
  });

  it('asks the repository the checkout statement NAMES, not the one the session is in', () => {
    // `CHECKOUT_REPO` passed `""` for the `-C` while the extraction regex two lines below it
    // explicitly matched `git -C <path> checkout <ref>`. So a checkout naming another repository
    // was looked up in THIS one — both the branch-held question and the already-on-it exemption
    // answered about the wrong repo. RAN against the pre-fix hook: exit 0.
    const { status } = runHook({
      command: `git -C ${otherRepo} checkout ${otherHeld}; git status`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('does not block a checkout in another repo of a branch nobody holds', () => {
    // The other half of the same resolution: asking the named repository must not turn every
    // cross-repo checkout into a refusal.
    const { status } = runHook({
      command: `git -C ${otherRepo} checkout ${otherFree}; git status`,
      cwd: mainRepo,
    });

    expect(status).toBe(0);
  });

  it('BLOCKS a checkout with a git SUBSTITUTION between the verb and the ref', () => {
    // The defect fixed in `statement_is_destructive` was still present one function over, and
    // review found it there. `hook_statement_all_words` flattens a substitution into the same word
    // stream, so the inner `git` cleared the verb and the next word — `config` — hit the "other
    // subcommand" exit and ended the reading before `held` was ever seen.
    //
    // RAN against that version: exit 0. The reader is statement-scoped now and returns EVERY
    // candidate, because with a substitution flattened in, which word git treats as the ref is not
    // decidable here — and a guard that has to guess should check them all.
    const { status } = runHook({
      command: `git checkout $(git config user.name) ${held}; git reset --hard`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('treats a bare PIPE as a continuation, like `;` and `&&`', () => {
    // The trigger matched `&&`, `||`, `;` and a newline, and review found `|` missing:
    // `git checkout <held> | git reset --hard` never entered the block. The destructive judgement
    // that would otherwise catch it sits behind the worktree-session gate, so OUTSIDE such a
    // session neither block saw it.
    const { status } = runHook({
      command: `git checkout ${held} | git reset --hard`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('treats a bare AMPERSAND as a continuation too', () => {
    // The third separator to be found missing one round at a time — `|` last round, `&` this one.
    // `git checkout <held> & git reset --hard` separates the statements like `;` does, except worse:
    // it does not even wait for the checkout to fail before running what follows.
    const { status } = runHook({
      command: `git checkout ${held} & git reset --hard`,
      cwd: mainRepo,
    });

    expect(status, 'a backgrounded checkout hid the continuation').toBe(2);
  });

  it('is not disarmed by a substitution AFTER the target carrying its own `--`', () => {
    // The mirror image of the earlier substitution case, and review supplied the repro: with the
    // real target BEFORE a substitution whose inside contains `--`, the flattened stream put the
    // target in the exempted half and it fell out of the candidate list entirely. The separator
    // verdict is read at the TOP level now, where a substitution is a hidden token — only the
    // statement's own `-- <pathspec>` exempts.
    const { status } = runHook({
      command: `git checkout ${held} $(git log --oneline -- README.md); git reset --hard`,
      cwd: mainRepo,
    });

    expect(status, "a substitution's own -- exempted the statement's target").toBe(2);
  });

  it('reads the branch a `worktree add` takes, and skips its path', () => {
    // `git worktree add <path> <branch>` fails on a held <branch> exactly like a checkout, and in a
    // compound command the statements after it still run — review found the whole accident outside
    // this reader, arriving through a different verb. The path positional is a directory, never a
    // branch a sibling can hold, and must not become a false candidate.
    const { status } = runHook({
      command: `git worktree add ../scratch-here ${held}; git reset --hard`,
      cwd: mainRepo,
    });
    expect(status, 'a held branch behind worktree add went unread').toBe(2);

    const ok = runHook({
      command: 'git worktree add ../scratch-here some-brand-new-branch; git status',
      cwd: mainRepo,
    });
    expect(ok.status, 'an unheld branch was refused').toBe(0);
  });

  it('does not read a START-POINT as a branch that must be free', () => {
    // Review supplied the false positive, and it lands on the exact spawn pattern
    // worktree-parallel-orchestration uses: `git worktree add -b task-9 ../wt9 <base>` bases a NEW
    // branch on a ref a sibling may legitimately hold — the main checkout being on the base branch
    // is the normal state, not the hazard. With `-b`/`-B` the branch comes from the FLAG, so the
    // positional after the path is a commit-ish, not a second branch.
    const { status } = runHook({
      command: `git worktree add -b task-9 ../wt9 ${held}; pnpm install`,
      cwd: mainRepo,
    });

    expect(status, 'basing a new branch on a held ref was refused').toBe(0);
  });

  it('reads a value FUSED to its create flag', () => {
    // `-Bheld` and `--track=origin/held` are ordinary git grammar; the exact-match cases missed
    // both, they fell into the generic-flag skip, and the branch names were never candidates —
    // review supplied both repros, and each was exit 0 before the fix.
    for (const command of [
      `git checkout -B${held}; git reset --hard`,
      `git checkout --track=origin/${held}; git reset --hard`,
      `git checkout --orphan=${held}; git reset --hard`,
    ]) {
      const { status } = runHook({ command, cwd: mainRepo });
      expect(status, command).toBe(2);
    }
  });

  it("leaves git's own escape hatch for a held ref alone too", () => {
    // `--ignore-other-worktrees` is git's documented way to say "I know a sibling holds it, do it
    // anyway" — the checkout SUCCEEDS, so this block's failed-checkout premise does not apply, and
    // refusing it turned git's escape hatch into this guard's wall. Same class as `--detach`, one
    // round later.
    const { status } = runHook({
      command: `git checkout --ignore-other-worktrees ${held}; git status`,
      cwd: mainRepo,
    });

    expect(status, "git's escape hatch was read as a branch switch").toBe(0);
  });

  it('leaves a DETACHED checkout of a held ref alone', () => {
    // `git checkout --detach <held>` SUCCEEDS while a sibling holds the branch — HEAD detaches, no
    // branch is taken — so this block's premise (a checkout that fails with statements still to
    // run) does not apply, and refusing it was the guard firing on correct work.
    const { status } = runHook({
      command: `git checkout --detach ${held}; git status`,
      cwd: mainRepo,
    });

    expect(status, 'a detached checkout was read as a branch switch').toBe(0);
  });

  it('reads the LOCAL name a tracked checkout derives', () => {
    // `git checkout -t origin/<held>` derives local `<held>` from the tracking ref, and the derived
    // name is what has to be free. The reader emitted only the raw `origin/<held>`, which matches
    // no `refs/heads/…` line — so the exact accident this block exists for sailed through. Review
    // supplied the repro; both spellings are candidates now.
    const { status } = runHook({
      command: `git checkout -t origin/${held}; git reset --hard`,
      cwd: mainRepo,
    });

    expect(status, 'the derived local name was never a candidate').toBe(2);
  });

  it('reads the ref `--track` derives a branch from', () => {
    // `git checkout -t <ref>` without `-b` derives the new branch FROM that ref, so its value is a
    // candidate rather than a throwaway. It was in the skip list beside `--start-point`.
    const { status } = runHook({
      command: `git checkout -t ${held}; git reset --hard`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('REFUSES a command it cannot split into statements', () => {
    // The block used to turn "could not split" into "no statements" with `|| printf ''` and permit
    // the whole command — the asymmetry review pointed out beside the destructive block, which
    // fails closed on the same condition. This asserts the refusal exists rather than reproducing
    // an unsplittable command, which the tokenizer does not currently produce.
    const hookText = readFileSync(HOOK, 'utf8');
    expect(hookText).toMatch(/could not be split into statements, so which/);
  });

  it('leaves a held checkout that is the LAST statement alone', () => {
    // The block's own premise is "the statements after it still run" — and the bare-command case at
    // the top already says that a checkout with nothing after it is git's own error and the whole
    // outcome. The loop judged every statement regardless, so `echo build; git checkout <held>` was
    // refused although nothing runs after it. RAN before the fix: exit 2.
    const { status } = runHook({ command: `echo build; git checkout ${held}`, cwd: mainRepo });

    expect(status, 'a checkout with nothing after it was refused').toBe(0);
  });

  it('reads `git checkout <ref> --` with NOTHING after it as a switch', () => {
    // A trailing `--` is git's documented way to say "what came before is a revision, not a path"
    // (`git <command> [<revision>...] -- [<file>...]`), and with no pathspec after it the command is
    // an ordinary branch switch. The pre-scan treated ANY bare `--` in the statement as a restore,
    // so `git checkout <held> --; git reset --hard` reproduced the exact hazard this block exists
    // for — the checkout fails because a sibling holds the branch, and the reset then runs against
    // whatever is actually checked out — while bypassing detection entirely. Review found it; the
    // existing coverage only had the genuine restore form, which has a pathspec.
    const { status } = runHook({
      command: `git checkout ${held} --; git reset --hard`,
      cwd: mainRepo,
    });

    expect(status, 'a trailing -- was read as a restore').toBe(2);
  });

  it('is not disarmed by a `--` inside a nested substitution', () => {
    // `hook_statement_all_words` flattens substitutions into one word list, so the `--` in
    // `$(git log --oneline -- README.md)` sat in the same stream as the real target. The old
    // pre-scan returned "no candidates" at the first `--`, and the exact accident this block
    // exists for — checkout fails, `reset --hard` lands on the wrong branch — sailed through.
    // Review found it, and found the substitution coverage only had a `--`-free substitution.
    //
    // The separator is positional now: it exempts the candidates BEFORE it (the restore-ref
    // reading) and the words after it are still checked, which is the same trade every other
    // flattened candidate already makes.
    const { status } = runHook({
      command: `git checkout $(git log --oneline -- README.md) ${held}; git reset --hard`,
      cwd: mainRepo,
    });

    expect(status, 'a substitution-internal -- disarmed the reader').toBe(2);
  });

  it('leaves `git checkout <ref> -- <path>` alone', () => {
    // Restoring files FROM a ref does not switch to it, so it succeeds even while a sibling worktree
    // holds that branch — the premise behind this block does not apply. Blocking it would be the
    // guard firing on correct work, which is what gets a guard turned off. Review found it.
    const { status } = runHook({
      command: `git checkout ${held} -- README.md; ls`,
      cwd: mainRepo,
    });

    expect(status).toBe(0);
  });

  it('is not blinded by an unrelated restore in front of a real switch', () => {
    // The restore exemption matched the WHOLE command and only the first checkout was read, so one
    // harmless `git checkout -- README.md` in front erased the detection of a real switch behind it.
    // Measured: permitted. This file had already learned the lesson twice — the stash check and the
    // override both say a token sitting on a sibling command excuses nothing — and the reading was
    // re-derived here without it.
    const { status } = runHook({
      command: `git checkout -- README.md; git checkout ${held}; git reset --hard`,
      cwd: mainRepo,
    });

    expect(status).toBe(2);
  });

  it('reads its variable list from the file that owns it', () => {
    // Three copies of the ambient-variable list existed and had already drifted — seven names in the
    // hook, nine in the gate. The list now lives in one file, and this asserts the hook reads THAT
    // file rather than a fourth copy: every name the owning file declares must appear in the hook's
    // behaviour, which is what the ambient case above exercises for GIT_DIR.
    const owned = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '../git-ambient-env.json'), 'utf8'),
    ).variables;
    const hookText = readFileSync(HOOK, 'utf8');

    expect(owned.length).toBeGreaterThan(0);
    // The hook must NOT spell the names out — that is how the copies drifted.
    const spelledOut = owned.filter((name) =>
      new RegExp(`for _var in[^\\n]*${name}`).test(hookText),
    );
    expect(
      spelledOut,
      'the hook re-spells the list instead of reading the file that owns it',
    ).toEqual([]);
    expect(hookText).toMatch(/git-ambient-env\.json/);
  });
});
