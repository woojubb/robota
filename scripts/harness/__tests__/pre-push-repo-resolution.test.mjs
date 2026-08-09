/**
 * #1662 — the push is judged against the repository it will actually act on.
 *
 * `cd <worktree> && git push` was judged against the DECLARED tool cwd — the main clone — because
 * the `cd` runs after the hook reads the payload and there is no `git -C`. Measured: five worktree
 * pushes, each with a fresh 0-finding review recorded in its own worktree, all refused against a
 * stale record for a sixth, already-merged branch the main checkout was parked on. The mirror
 * direction is the one the hook exists for: a current record on the parked branch would wave an
 * UNREVIEWED worktree push through.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/pre-push-check.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** A repo whose review-record state the case controls: recorded = run the real recorder in it. */
function repoOn(branch, { recorded = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pre-push-repo-'));
  scratch.push(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, dir]);
  git('config', 'user.email', 'h@e.test');
  git('config', 'user.name', 'H');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'init');
  if (recorded) {
    execFileSync(
      'node',
      [path.join(WORKSPACE_ROOT, 'scripts/harness/record-local-review.mjs'), '--findings', '0'],
      { cwd: dir, encoding: 'utf8' },
    );
  }
  return dir;
}

function runHook(command, declaredCwd) {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd: declaredCwd, tool_input: { command } });
  const result = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: declaredCwd },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('which repository the push verdict is about', () => {
  it('judges `cd <worktree> && git push` against the WORKTREE, not the declared cwd', () => {
    // The false-refusal half of #1662: the pushed repo has a fresh 0-finding record, the declared
    // cwd (standing in for the parked main clone) has NONE — so a verdict about the wrong repo is
    // a refusal, and a verdict about the right one is a pass.
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`cd ${pushed} && git push origin feat/target`, parked);

    expect(status, `judged the parked repo, not the pushed one:\n${output}`).toBe(0);
  });

  it('judges the FALSE-PASS mirror: a recorded parked branch must not excuse an unreviewed push', () => {
    // The direction the hook exists for. Declared cwd has a CURRENT record; the pushed worktree has
    // none. The old resolution read the parked record and waved the push through.
    const pushed = repoOn('feat/unreviewed');
    const parked = repoOn('feat/parked', { recorded: true });

    const { status } = runHook(`cd ${pushed} && git push origin feat/unreviewed`, parked);

    expect(status, "the parked repo's record excused an unreviewed push").toBe(2);
  });

  it('still follows a per-statement `git -C`', () => {
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status } = runHook(`git -C ${pushed} push origin feat/target`, parked);

    expect(status).toBe(0);
  });

  it('REFUSES when the cd target cannot be read', () => {
    // `cd "$DIR" && git push` — the target is a variable the hook cannot resolve. Judging the
    // declared cwd anyway is the wrong-repository answer; the hook says why and names the fix.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('cd "$SOMEWHERE" && git push origin x', parked);

    expect(status, 'an unreadable cd was judged against the declared cwd').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('REFUSES one command pushing from two repositories', () => {
    const a = repoOn('feat/a', { recorded: true });
    const b = repoOn('feat/b', { recorded: true });

    const { status, output } = runHook(
      `git -C ${a} push origin feat/a; git -C ${b} push origin feat/b`,
      a,
    );

    expect(status, 'two-repo push got one verdict').toBe(2);
    expect(output).toMatch(/two different repositories/);
  });

  it('keeps the plain in-session push working', () => {
    const repo = repoOn('feat/plain', { recorded: true });

    const { status, output } = runHook('git push origin feat/plain', repo);

    expect(status, `the ordinary case broke:\n${output}`).toBe(0);
  });

  it('resolves a SECOND relative cd against the first, not the declared cwd', () => {
    // `cd .. && cd <sibling> && git push` — every hop used to resolve against the declared cwd,
    // so the second landed on a path that does not exist and the fallback judged the main clone:
    // the pre-#1662 resolution, silently, for exactly this shape. (#1667 review)
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(
      `cd .. && cd ${path.basename(pushed)} && git push origin feat/target`,
      parked,
    );

    expect(status, `the chained relative cd was judged against the wrong repo:\n${output}`).toBe(0);
  });

  it('keeps a relative cd AFTER an unreadable one unreadable', () => {
    // The base of the hop is unknown, so the hop is too — resolving it against the declared cwd
    // would be the same silent regression one directory later.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('cd "$SOMEWHERE" && cd sub && git push origin x', parked);

    expect(status, 'a relative cd laundered the unreadable base').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('reads the target after a `--` end-of-options marker', () => {
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`cd -- ${pushed} && git push origin feat/target`, parked);

    expect(status, `cd -- <path> was treated as unreadable:\n${output}`).toBe(0);
  });

  it('follows the cd INSIDE a subshell — `(cd <dir> && git push)`', () => {
    // The parenthesis glues to the first word, so `(cd` was not `cd` and the whole idiom — the
    // usual way to push without moving the parent shell — fell back to the declared cwd: the
    // pre-#1662 resolution, for the shape people actually write. (#1667 review)
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`(cd ${pushed} && git push origin feat/target)`, parked);

    expect(status, `the subshell cd was invisible to the walk:\n${output}`).toBe(0);
  });

  it('does not let a CLOSED subshell cd leak into a later push', () => {
    // `(cd x) && git push` changes no directory the push will see. The still-parenthesised
    // target reads as unreadable rather than as a base the push never had.
    const parked = repoOn('feat/parked', { recorded: true });
    const other = repoOn('feat/other');

    const { status, output } = runHook(`(cd ${other}) && git push origin x`, parked);

    expect(status, 'a closed subshell cd was carried into the push').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('returns to where the shell stood when a pushd is popd-ed', () => {
    // pushd/popd bracketing an errand elsewhere: the push after popd runs where the shell began.
    const pushed = repoOn('feat/target', { recorded: true });
    const other = repoOn('feat/other');

    const { status, output } = runHook(
      `cd ${pushed} && pushd ${other} && ls && popd && git push origin feat/target`,
      pushed,
    );

    expect(status, `popd did not restore the tracked base:\n${output}`).toBe(0);
  });

  it('treats a popd with no tracked pushd as a base it cannot read', () => {
    // The real shell may have a directory stack this walk never saw filled.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('popd && git push origin x', parked);

    expect(status, "an unseen stack's popd was guessed at").toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('follows the cd inside a BRACE group — `{ cd <dir>; git push; }`', () => {
    // Unlike `(`, a brace opener must be its own word, so the cd sits one word later and an
    // unshifted read fell back to the declared cwd for a form bash itself accepts.
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`{ cd ${pushed}; git push origin feat/target; }`, parked);

    expect(status, `the brace-group cd was invisible to the walk:\n${output}`).toBe(0);
  });

  it('follows the cd behind a BYPASS prefix — `builtin cd`, `command cd`, `\\cd`', () => {
    // Each is the cd builtin skipping a function or alias; each left the walk blind, so the
    // push was judged where the shell no longer stood.
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    for (const spelling of ['builtin cd', 'command cd', '\\cd']) {
      const { status, output } = runHook(
        `${spelling} ${pushed} && git push origin feat/target`,
        parked,
      );
      expect(status, `'${spelling}' was invisible to the walk:\n${output}`).toBe(0);
    }
  });

  it('treats a target with an EMBEDDED substitution as unreadable', () => {
    // `cd /pre$(x)post` words as the clean-looking literal `/prepost` — the substitution and its
    // delimiters are dropped by words-mode — which is not where the shell will land.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('cd /pre$(x)post && git push origin x', parked);

    expect(status, 'an embedded substitution resolved as a literal path').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('unwraps STACKED bypass prefixes — `command builtin cd`', () => {
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(
      `command builtin cd ${pushed} && git push origin feat/target`,
      parked,
    );

    expect(status, `the stacked prefixes re-blinded the walk:\n${output}`).toBe(0);
  });

  it('treats a quoted target with inner spaces as unreadable', () => {
    // Words-mode hides quoted content with spaces, leaving bare quote marks — resolving that
    // literally would judge a path of quote characters.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('cd "/path with space" && git push origin x', parked);

    expect(status, 'a space-bearing quoted target resolved as quote marks').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('keeps the target through prefixes AND the end-of-options marker together', () => {
    // `command builtin cd -- <path>` needs five words; a four-word capture dropped the path.
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(
      `command builtin cd -- ${pushed} && git push origin feat/target`,
      parked,
    );

    expect(status, `the fifth word (the path) was dropped:\n${output}`).toBe(0);
  });

  it('an unreadable pushd still costs a stack frame — popd after it is unreadable', () => {
    // Real bash moved the stack one frame (or failed and moved none — unknowable); a model one
    // frame short handed popd the PREVIOUS directory with full confidence.
    const parked = repoOn('feat/parked');
    const known = repoOn('feat/known', { recorded: true });

    const { status, output } = runHook(
      `pushd ${known} && pushd "$UNKNOWN" && popd && git push origin x`,
      parked,
    );

    expect(status, 'popd after an unreadable pushd resolved with confidence').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('an env-var prefix does not make a literal cd target unreadable', () => {
    // The raw check is scoped to the TARGET TOKEN: `V=$(x) cd <literal>` carries its $ in the
    // prefix, not the target.
    const pushed = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(
      `SOME_VAR=$(echo hi) cd ${pushed} && git push origin feat/target`,
      parked,
    );

    expect(status, `a prefix substitution refused a literal target:\n${output}`).toBe(0);
  });

  it('treats a pushd stack rotation as a target it cannot read', () => {
    // `pushd +1` lands wherever the shell's directory stack says — a place only that shell knows.
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('pushd +1 && git push origin x', parked);

    expect(status, 'a stack rotation was concatenated onto the cwd as a directory name').toBe(2);
    expect(output).toMatch(/cannot read/);
  });
});
