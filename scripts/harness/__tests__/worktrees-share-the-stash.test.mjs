import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LOCK_WRAPPER = path.join(WORKSPACE_ROOT, 'scripts/harness/with-repo-lock.sh');
const PRE_COMMIT = path.join(WORKSPACE_ROOT, '.husky/pre-commit');
const ROOT_PACKAGE = path.join(WORKSPACE_ROOT, 'package.json');

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo() {
  const dir = makeTemp('repo-lock-');
  scratch.push(dir);
  const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  return dir;
}

function hermeticFlockBin(cwd) {
  const bin = path.join(cwd, '.test-bin');
  const executable = path.join(bin, 'flock');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    executable,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "${1:-}" == "-w" ]]; then shift 2; fi',
      'lock_file="$1"',
      'shift',
      'lock_dir="${lock_file}.test-lock"',
      'while ! mkdir "$lock_dir" 2>/dev/null; do sleep 0.01; done',
      'cleanup() { rmdir "$lock_dir"; }',
      'trap cleanup EXIT HUP INT TERM',
      '"$@"',
      '',
    ].join('\n'),
  );
  chmodSync(executable, 0o755);
  return bin;
}

/**
 * Two concurrent runs, each reporting when IT entered and left its critical section.
 *
 * The timestamps are captured when this process observes the CHILD'S explicit IN/OUT markers. A
 * first version measured spawn-to-close and failed against a lock that demonstrably worked: the
 * second process is spawned immediately either way and simply waits, so its spawn time precedes the
 * first one's exit whether or not anything is serialised. The child markers preserve the actual
 * critical-section boundary while Node's monotonic clock avoids GNU/BSD `date` differences.
 *
 * The property asserted is that the two sections do not OVERLAP. Ordering would be a coin flip;
 * non-overlap is what the lock actually promises.
 */
function criticalSections(cwd, wrapped) {
  const command = 'echo IN; sleep 0.2; echo OUT';
  const flockBin = wrapped ? hermeticFlockBin(cwd) : null;
  return Promise.all(
    [0, 1].map(
      () =>
        new Promise((resolve) => {
          const argv = wrapped ? [LOCK_WRAPPER, 'bash', '-c', command] : ['-c', command];
          const env = flockBin
            ? { ...process.env, PATH: `${flockBin}:${process.env.PATH}` }
            : process.env;
          const child = spawn('bash', argv, { cwd, encoding: 'utf8', env });
          let out = '';
          let buffered = '';
          let enter = NaN;
          let leave = NaN;
          const observe = (chunk) => {
            buffered += chunk;
            let newline = buffered.indexOf('\n');
            while (newline !== -1) {
              const line = buffered.slice(0, newline).trim();
              buffered = buffered.slice(newline + 1);
              const observedAt = performance.now();
              if (line === 'IN' && !Number.isFinite(enter)) enter = observedAt;
              if (line === 'OUT' && !Number.isFinite(leave)) leave = observedAt;
              newline = buffered.indexOf('\n');
            }
          };
          child.stdout.on('data', (d) => {
            const chunk = String(d);
            out += chunk;
            observe(chunk);
          });
          child.stderr.on('data', (d) => (out += d));
          child.on('close', (code) => {
            resolve({ code, out, enter, leave });
          });
        }),
    ),
  );
}

function overlaps(runs) {
  const [a, b] = runs.sort((x, y) => x.enter - y.enter);
  return { overlapped: b.enter < a.leave, a, b };
}

describe('a worktree does not share its neighbour lint-staged backup', () => {
  it('serialises the critical section across concurrent runs', async () => {
    const dir = scratchRepo();
    const runs = await criticalSections(dir, true);
    for (const run of runs) {
      expect(run.code, `a run failed: ${run.out}`).toBe(0);
      expect(
        Number.isFinite(run.enter) && Number.isFinite(run.leave),
        `no timestamps: ${run.out}`,
      ).toBe(true);
    }
    const { overlapped, a, b } = overlaps(runs);
    expect(
      overlapped,
      `the two sections overlapped: ${a.enter}-${a.leave} and ${b.enter}-${b.leave}`,
    ).toBe(false);
  });

  it('proves the case above is not vacuous — unwrapped, they DO overlap', async () => {
    // Without this, "they did not overlap" would also pass on a machine that happened to run them
    // one after another, and the locked case would prove nothing.
    const dir = scratchRepo();
    const runs = await criticalSections(dir, false);
    const { overlapped, a, b } = overlaps(runs);
    expect(
      overlapped,
      `the unwrapped pair did not overlap (${a.enter}-${a.leave}, ${b.enter}-${b.leave}), so the locked case proves nothing`,
    ).toBe(true);
  });

  it('refuses when it cannot find the repository, rather than running unserialised', () => {
    // Fail closed. Running without the lock here is the exact hazard, so "cannot tell" is a refusal.
    const outside = makeTemp('not-a-repo-');
    scratch.push(outside);
    const result = spawnSync('bash', [LOCK_WRAPPER, 'true'], {
      cwd: outside,
      encoding: 'utf8',
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(outside) },
    });
    expect(result.status, `it ran anyway: ${result.stdout}${result.stderr}`).not.toBe(0);
  });

  it('refuses an empty command rather than reporting success over nothing', () => {
    const dir = scratchRepo();
    const result = spawnSync('bash', [LOCK_WRAPPER], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(2);
  });

  it('the pre-commit hook reaches the lock through the root staged-fix command', () => {
    // Registered is not reached. A lock nothing calls is a file, and lint-staged is the one caller
    // that matters — it is the shared-stash user every commit passes through, whether or not the
    // author ever types `git stash`.
    // Backslash continuations are joined FIRST. A line-by-line reading called the wired-up hook
    // unwired, because the invocation spans three lines — the check would have forced the shell to
    // be written a particular way rather than to do the right thing, and a guard that polices
    // formatting is one people route around.
    const statements = readFileSync(PRE_COMMIT, 'utf8')
      .replace(/\\\r?\n\s*/g, ' ')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'));
    const stagedDelegation = statements.filter((line) => line.includes('pnpm lint:fix:staged'));
    const scripts = JSON.parse(readFileSync(ROOT_PACKAGE, 'utf8')).scripts ?? {};
    const stagedFix = scripts['lint:fix:staged'] ?? '';

    expect(stagedDelegation, 'the hook no longer delegates to lint:fix:staged').not.toHaveLength(0);
    expect(stagedFix, 'the staged fixer no longer runs lint-staged').toContain('lint-staged');
    expect(stagedFix, 'lint-staged runs without the cross-worktree lock').toContain(
      'with-repo-lock.sh',
    );
    expect(
      stagedFix.match(/with-repo-lock\.sh/g) ?? [],
      'the staged fixer nests the lock',
    ).toHaveLength(1);
    expect(PRE_COMMIT, 'the hook acquires a second repository lock').not.toContain(
      '"$(git rev-parse --show-toplevel)/scripts/harness/with-repo-lock.sh"',
    );
  });
});

describe('a bare stash command is refused while the stack is shared', () => {
  // The other half of INFRA-082. The lock covers the caller nobody chooses — lint-staged, on every
  // commit. This covers the one an agent types, which is what the rule in git-branch.md has asked
  // for since LESSON-005 (2026-06-15) and which an agent did anyway ten weeks later, because the
  // rule was written down and never mechanically reached.
  const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/worktree-cwd-guard.sh');

  function repoWithWorktrees(count) {
    const dir = scratchRepo();
    const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    spawnSync('bash', ['-c', 'printf x > f'], { cwd: dir });
    git('add', '-A');
    git('commit', '--quiet', '-m', 'root');
    for (let i = 1; i < count; i += 1) {
      git('worktree', 'add', '--detach', '--quiet', path.join(dir, `wt-${i}`), 'HEAD');
    }
    return dir;
  }

  function run(command, dir, overrides = {}) {
    const result = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', cwd: dir, tool_input: { command } }),
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CLAUDE_PROJECT_DIR: dir,
        ...overrides,
      },
      timeout: 120_000,
    });
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  /**
   * A PATH whose `git` produces no output and exits non-zero — the state that made the old
   * `grep -c . || echo 0` expression yield a two-line count and fall open.
   *
   * The rest of the real PATH follows it, so the hook's other tools still resolve; only `git` is
   * shadowed, which is the single input under test.
   */
  function mkFailingGitPath() {
    const dir = makeTemp('failing-git-');
    scratch.push(dir);
    writeFileSync(path.join(dir, 'git'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    return `${dir}:${process.env.PATH}`;
  }

  it('refuses a bare pop or apply when a sibling worktree exists', () => {
    const dir = repoWithWorktrees(2);
    for (const command of ['git stash pop', 'git stash apply', 'git stash']) {
      expect(
        run(command, dir).status,
        `a bare stash command was allowed while another worktree exists: ${command}`,
      ).not.toBe(0);
    }
  });

  it('allows the explicit form, and read-only queries, silently', () => {
    // A guard that refuses the correct form is one people switch off. The rule names
    // `git stash pop stash@{N}` as the right way, so that must keep working.
    const dir = repoWithWorktrees(2);
    for (const command of [
      'git stash pop stash@{0}',
      'git stash apply stash@{2}',
      'git stash list',
      'git stash show -p stash@{0}',
    ]) {
      const { status, output } = run(command, dir);
      expect(status, `the documented form was refused: ${command} -> ${output}`).toBe(0);
      expect(output, `the guard narrated on the happy path: ${command} -> ${output}`).toBe('');
    }
  });

  it('leaves a single-worktree clone alone', () => {
    // The hazard is a SHARED stack. With one worktree there is nothing to race, and refusing there
    // would be the guard firing on correct work.
    const dir = repoWithWorktrees(1);
    const { status, output } = run('git stash pop', dir);
    expect(status, `a bare pop was refused in a clone with one worktree: ${output}`).toBe(0);
  });

  it('refuses every subcommand that touches the shared stack, not only the ones first thought of', () => {
    // Review of #1585. `clear` and `branch` were missing from the list, and both match the threat
    // model exactly: `clear` takes no argument and deletes EVERY entry, including ones another agent
    // has not popped yet; `branch` with no ref implicitly takes the top of the stack.
    const dir = repoWithWorktrees(2);
    for (const command of ['git stash clear', 'git stash branch feat/x']) {
      expect(
        run(command, dir).status,
        `a shared-stack subcommand was allowed: ${command}`,
      ).not.toBe(0);
    }
  });

  it('allows git stash branch with an explicit ref', () => {
    // `branch` names its source when given one, so it takes nobody else's entry.
    const dir = repoWithWorktrees(2);
    const { status, output } = run('git stash branch feat/x stash@{0}', dir);
    expect(status, `the explicit form was refused: ${output}`).toBe(0);
  });

  it('refuses rather than waving through when the worktree count cannot be read', () => {
    // Review of #1585, finding 3, and it is the one that mattered: `git … | grep -c . || echo 0`
    // yields the TWO-LINE string "0\n0" when the git call produces nothing, because `grep -c` prints
    // 0 and exits 1, so the `||` fires as well. The arithmetic comparison then errors and the guard
    // falls open — inside the same PR whose own `with-repo-lock.sh` says "cannot resolve it, so
    // refuse". Measured before the fix:
    //     count=[0
    //     0]
    //     bash: [: 0\n0: integer expression expected
    const dir = repoWithWorktrees(2);
    const { status, output } = run('git stash pop', dir, {
      // A `git` that produces nothing and fails, which is the state the old expression mishandled.
      PATH: mkFailingGitPath(),
    });
    expect(status, `an unreadable worktree count waved the command through: ${output}`).not.toBe(0);
  });

  it('is not escaped by a backtick or by a flag-only push', () => {
    // Review of #1585, both real bypasses of the gate this PR exists to close.
    //
    // 1. The entry boundary class omitted the BACKTICK that this same file's GITPFX includes a few
    //    lines below, for exactly this reason. `OUT=`git stash pop`` never reached the gate at all.
    // 2. `git stash -u` / `--all` / `-k` are implicit pushes — they add an entry another agent's
    //    bare pop can take — and matched none of the branches, which looked only for the literal
    //    words `push`/`save`.
    const dir = repoWithWorktrees(2);
    for (const command of [
      'OUT=`git stash pop`',
      'OUT=$(git stash pop)',
      'git stash -u',
      'git stash --all',
      'git stash -k',
    ]) {
      expect(run(command, dir).status, `a stash command escaped the gate: ${command}`).not.toBe(0);
    }
  });

  it('a ref on a sibling statement does not excuse a bare one', () => {
    // Review of #1585, MUST. The ref check asked whether `stash@{` occurs ANYWHERE in the command,
    // not whether the matched subcommand is the one carrying it. So a bare pop travelled free
    // alongside a well-formed sibling — and a comment was enough.
    //
    // This file had already met and closed this class further down, for the destructive-command
    // override: "excused only if the override prefixes THAT statement; the token sitting on a
    // sibling command excuses nothing". The new block did not reuse that split and reintroduced it.
    const dir = repoWithWorktrees(2);
    for (const command of [
      'git stash pop; git stash pop stash@{0}',
      'git stash pop  # stash@{0}',
      'git stash pop stash@{0} && git stash drop',
    ]) {
      expect(
        run(command, dir).status,
        `a ref on a sibling statement excused a bare one: ${command}`,
      ).not.toBe(0);
    }
  });

  it('still allows a command whose every stash statement names its ref', () => {
    // The other direction, so the case above cannot be satisfied by refusing all compounds.
    const dir = repoWithWorktrees(2);
    const { status, output } = run('git stash pop stash@{0}; git stash drop stash@{1}', dir);
    expect(status, `a fully-explicit compound was refused: ${output}`).toBe(0);
  });

  it('is not escaped by a global git flag', () => {
    // Review of #1585, MUST — and the FOURTH time in this PR that a rule already written down in
    // this file was re-derived worse a few lines away. GITPFX tolerates `git -C <path>` and
    // `git -c k=v` before the subcommand; the entry gate written beside it did not, so
    // `git -C <sibling-worktree> stash pop` skipped the whole shared-stash check.
    //
    // A `-C` pointing at a SIBLING worktree is the sharpest form of the hazard, not an edge case:
    // it is how one worktree reaches into another in the first place.
    const dir = repoWithWorktrees(2);
    const sibling = path.join(dir, 'wt-1');
    for (const command of [
      `git -C ${sibling} stash pop`,
      `git -c core.editor=true stash`,
      `git -C ${sibling} stash clear`,
    ]) {
      expect(run(command, dir).status, `a global flag escaped the gate: ${command}`).not.toBe(0);
    }
  });

  it('still allows the explicit form behind a global flag', () => {
    const dir = repoWithWorktrees(2);
    const sibling = path.join(dir, 'wt-1');
    const { status, output } = run(`git -C ${sibling} stash pop stash@{0}`, dir);
    expect(status, `the explicit form behind -C was refused: ${output}`).toBe(0);
  });

  it('refuses when no directory can be named, instead of judging the hook own cwd', () => {
    // Review of #1585, MUST — and the FIFTH time this change re-derived something this file already
    // documents. Its own comment on EFFECTIVE_DIR says why `.` was rejected there: "`.` is wherever
    // the hook binary runs, not where the tool command runs — resolving its toplevel would judge an
    // unrelated checkout (this caused a fail-safe bug)". I wrote that fallback back in.
    //
    // The fixture makes the difference visible: the hook PROCESS sits in a repo with ONE worktree,
    // and the payload names no directory at all. With the `.` fallback the count comes from that
    // unrelated repo, reads 1, and a bare pop is waved through — while the repository the command
    // would really act on is unknown and may well be shared.
    //
    // Refuse rather than fail-safe, and that differs from the destructive-command path deliberately:
    // a bare pop always HAS a correct form (`stash@{N}`), so refusing costs the caller a ref they
    // should have written anyway. The destructive path has no such substitute, which is why it
    // fails safe instead.
    //
    // A first version of this case set `cwd` to the MULTI-worktree repo and passed on arrival — it
    // blocked for the ordinary reason and proved nothing.
    const unrelated = repoWithWorktrees(1);
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git stash pop' } });
    const result = spawnSync('bash', [HOOK], {
      input: payload,
      cwd: unrelated,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeout: 120_000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(
      result.status ?? 1,
      `a nameless directory was judged against the hook own cwd: ${output}`,
    ).not.toBe(0);
  });

  it('is not escaped by a `#` that is not a comment', () => {
    // Review of #1585, MUST — and this bypass was INTRODUCED by the previous round's fix. I added
    // `sed 's/#.*$//'` to strip comments, on top of a tokenizer that already masks real ones (only a
    // `#` at a word boundary opens a comment). The second pass cannot tell those apart, so a literal
    // `#` mid-word deleted the rest of the line — including the bare pop after it.
    //
    // The shapes are ordinary: a URL fragment, an unquoted issue reference.
    const dir = repoWithWorktrees(2);
    for (const command of [
      'echo a#b; git stash pop',
      'echo https://x/y#section; git stash pop',
      'echo fix#123 && git stash clear',
    ]) {
      expect(run(command, dir).status, `a non-comment # escaped the gate: ${command}`).not.toBe(0);
    }
  });

  it('still ignores a real trailing comment', () => {
    // The other direction: a genuine comment must not turn into a ref. `git stash pop # stash@{0}`
    // is a BARE pop with a comment after it, and the round that added comment-stripping was fixing
    // exactly that. Both must hold at once.
    const dir = repoWithWorktrees(2);
    expect(
      run('git stash pop  # stash@{0}', dir).status,
      'a commented ref excused a bare pop',
    ).not.toBe(0);
    expect(
      run('git stash pop stash@{0}  # fine', dir).status,
      'a real comment refused a good command',
    ).toBe(0);
  });

  it('does not take the repository from a different statement -C', () => {
    // Review of #1585, SHOULD. `STASH_REPO` came from `hook_git_c_path` over the WHOLE command, so a
    // `-C` on an unrelated call decided which repository the worktree count was taken from:
    //
    //     git -C /elsewhere fetch; git stash pop
    //
    // The bare pop acts on the session repository — possibly shared — while the count was read from
    // `/elsewhere`. One worktree there and the guard waved it through: the same `-C points somewhere
    // else` class the earlier round closed, arriving from a sibling statement instead.
    const dir = repoWithWorktrees(2);
    const single = repoWithWorktrees(1);
    expect(
      run(`git -C ${single} fetch; git stash pop`, dir).status,
      `a sibling statement -C decided the repository`,
    ).not.toBe(0);
  });

  it('still reads the -C of the stash statement itself', () => {
    // The other direction, so the fix is not "ignore -C entirely" — that would undo the round that
    // closed `git -C <sibling> stash pop`.
    const single = repoWithWorktrees(1);
    const shared = repoWithWorktrees(2);
    expect(
      run(`git -C ${shared} stash pop`, single).status,
      'the stash statement own -C was ignored',
    ).not.toBe(0);
  });

  it('judges every bare statement against its own repository', () => {
    // Review of #1585, MUST. The `-C` was captured from whichever statement tripped bare FIRST and
    // never re-derived, so two independently-bare stash operations against two different repos were
    // both judged against the first one:
    //
    //     git -C <single-worktree scratch> stash push; git -C <shared> stash pop
    //
    // Count 1 from the scratch repo, whole command allowed — including the second, genuinely bare
    // pop against the shared clone. That is the incident this guard exists for, reopened for the
    // multi-statement case.
    const scratch = repoWithWorktrees(1);
    const shared = repoWithWorktrees(2);
    expect(
      run(`git -C ${scratch} stash push; git -C ${shared} stash pop`, scratch).status,
      'the first statement repository answered for the second',
    ).not.toBe(0);
  });

  it('reads a quoted -C path with a space', () => {
    // Review of #1585, SHOULD. `hook_git_c_path` was handed `$STMT`, a slice of the ALREADY-MASKED
    // command, so a quoted path containing whitespace came back as \001 bytes — non-empty, so the
    // cwd/CLAUDE_PROJECT_DIR fallbacks never fired, and the guard blocked with "cannot read the
    // worktree list": a false positive that also defeated the fallback chain.
    //
    // The `-C` is read from the RAW command through the statement's window now, which is what
    // `hook_git_c_path`'s window parameters exist for.
    const parent = makeTemp('spaced-');
    scratch.push(parent);
    const spaced = path.join(parent, 'a repo');
    const git = (...a) => spawnSync('git', ['-C', spaced, ...a], { encoding: 'utf8' });
    mkdirSync(spaced, { recursive: true });
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.email', 'harness@example.test');
    git('config', 'user.name', 'Harness');
    writeFileSync(path.join(spaced, 'f'), 'x');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'root');

    const { status, output } = run(`git -C "${spaced}" stash pop stash@{0}`, spaced);
    expect(status, `a quoted path with a space was misread: ${output}`).toBe(0);
    expect(output, `the guard spoke on a correct command: ${output}`).toBe('');
  });
});
