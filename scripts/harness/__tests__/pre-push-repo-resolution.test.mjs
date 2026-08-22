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
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/pre-push-check.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/** A repo whose review-record state the case controls: recorded = run the real recorder in it. */
function repoOn(branch, { recorded = false } = {}) {
  const dir = makeTemp('pre-push-repo-');
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

  it('resolves a LONG chain of ordinary statements correctly (HARNESS-083 scale)', () => {
    // 200 non-directory statements before the push. The per-statement mask/words re-tokenization
    // that used to run for EVERY one made this shape take ~10s (O(N²)); the whole-command mask is
    // now sliced and a non-cd statement skips the word fork, so the walk is flat in N. This is the
    // large-N fixture the acceptance asks for: correctness at scale (the push still resolves to the
    // in-session repo), not a timing assertion. (HARNESS-083)
    const repo = repoOn('feat/long', { recorded: true });
    const chain = Array.from({ length: 200 }, (_, i) => `echo step${i}`).join(' && ');

    const { status, output } = runHook(`${chain} && git push origin feat/long`, repo);

    expect(status, `a long ordinary chain broke the resolution:\n${output}`).toBe(0);
  });

  it('still tracks a cd buried deep in a LONG chain (the skip is conservative)', () => {
    // The word-fork skip keys on a raw `cd`/`pushd`/`popd` token, so a real cd late in a long chain
    // is still tracked — the push is judged against <target>, not the session. Proves the
    // optimization did not blind the walk to a directory change. (HARNESS-083)
    const target = repoOn('feat/target', { recorded: true });
    const parked = repoOn('feat/parked');
    const prefix = Array.from({ length: 150 }, (_, i) => `echo step${i}`).join(' && ');

    const { status, output } = runHook(
      `${prefix} && cd ${target} && git push origin feat/target`,
      parked,
    );

    expect(status, `a cd late in a long chain was skipped:\n${output}`).toBe(0);
  });

  it('does not re-tokenize per statement: awk forks stay CONSTANT as the chain grows', () => {
    // The regression guard for this task, measured deterministically rather than by wall clock: a
    // PATH shim counts real `awk` invocations and delegates to the real one. Timing in CI is noisy
    // and a slow runner would either flake or force slack so generous it catches nothing; the fork
    // COUNT is exactly what the acceptance names ("no longer scales O(N²) in awk forks") and is
    // immune to load. Measured on the version this task replaced: 6 forks at N=1 and 204 at N=100 —
    // one whole-command re-tokenization per statement. Here it must not grow with N. (HARNESS-083)
    const repo = repoOn('feat/forks', { recorded: true });
    const shim = makeTemp('awk-shim-');
    scratch.push(shim);
    const counter = path.join(shim, 'count');
    writeFileSync(
      path.join(shim, 'awk'),
      `#!/usr/bin/env bash\necho x >> ${JSON.stringify(counter)}\nexec /usr/bin/awk "$@"\n`,
      { mode: 0o755 },
    );

    const forksFor = (statements) => {
      writeFileSync(counter, '');
      const chain = Array.from({ length: statements }, (_, i) => `echo s${i}`).join(' && ');
      spawnSync('bash', [HOOK], {
        input: JSON.stringify({
          tool_name: 'Bash',
          cwd: repo,
          tool_input: { command: `${chain} && git push origin feat/forks` },
        }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo, PATH: `${shim}:${process.env.PATH}` },
      });
      return readFileSync(counter, 'utf8').split('\n').filter(Boolean).length;
    };

    const few = forksFor(1);
    const many = forksFor(100);

    expect(few, 'the shim counted no awk at all — the probe measured nothing').toBeGreaterThan(0);
    // A small constant of slack, so a future change may add a fixed reading without failing here;
    // what must never return is a count that TRACKS the statement count.
    expect(
      many,
      `awk forks grew with the chain: ${few} at N=1, ${many} at N=100`,
    ).toBeLessThanOrEqual(few + 2);
  });

  it.each([
    ['a PARAMETER splice', 'c${UNSET}d'],
    ['a variable AS the command', '$EDITOR'],
    ['a substitution as the command', '$(echo cd)'],
    ['eval, which runs text this hook never parses', 'eval cd'],
  ])('treats %s in the command position as unreadable, not as "not a cd"', (label, command) => {
    // HARNESS-084 (#1682). words-mode collapses a splice built from quotes, backslashes, `$( )` and
    // backticks into the word `cd`, but it CANNOT collapse a parameter expansion — the masker
    // replaces `${…}` (closing brace included) with fill, so `c${UNSET}d` survives as `c${d` and no
    // reader ever sees the builtin. `$EDITOR` and `$(echo cd)` are the same fact one step further:
    // the command IS the expansion. Each was measured on develop as a wrong-repository fail-open —
    // exit 0, the push judged against the session repo while the real cd moved elsewhere.
    //
    // Collapsing them to `cd` would be WORSE than missing them: `c${HOME}d` is not a cd, and a
    // guard that guesses refuses correct work. So the hook declines to answer, which is the same
    // answer every other unknowable already gets. Parked is the RECORDED repo, so only the refusal
    // can be correct here.
    const target = repoOn('feat/target');
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(`${command} ${target} && git push origin x`, parked);

    expect(status, `${label} in the command position was read as "not a cd":\n${output}`).toBe(2);
  });

  it.each([
    ['quotes', '"c""d"'],
    ['an empty command substitution', 'c$()d'],
    ['a pair of empty backticks', 'c``d'],
  ])('does not let %s splice a `cd` past the skip', (label, spliced) => {
    // The word-fork skip keys on a raw `cd`-shaped token, but a splice assembles the builtin out of
    // pieces that carry no such token — and it needs neither a quote NOR a backslash to do it.
    // Each of these was MEASURED as a wrong-repository fail-open while building the skip: the
    // statement was skipped, the push resolved to the SESSION repo (which has a clean record) while
    // the real cd moved elsewhere, and the hook exited 0 where it had refused.
    //
    // The first fix blocklisted quote/backslash and the review found `$()`/backticks straight
    // through it, so the skip now takes an ALLOWLIST — letters, digits, whitespace and plain path
    // punctuation — and ANY expansion character forces the full walk. Enumerating splice
    // mechanisms is the whack-a-mole that produced this defect twice.
    //
    // STATED LIMIT: a PARAMETER splice (`c${UNSET}d`) is still not seen, because words-mode never
    // builds the word `cd` from it. That is pre-existing — measured identically on develop — and is
    // filed as HARNESS-084 (#1682) rather than papered over here.
    //
    // Parked is the RECORDED repo, so a skip would PASS and only correct tracking refuses.
    // (HARNESS-083 / #1681 review, two rounds)
    const target = repoOn('feat/target');
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(`${spliced} ${target} && git push origin x`, parked);

    expect(status, `a ${label} splice was skipped and the session repo judged:\n${output}`).toBe(2);
  });

  it('does not flag a trailing-slash spelling of the same repo as two repositories', () => {
    // `git -C <A> push; git -C <A>/ push`: the same repo, two spellings. A raw string compare read
    // them as a two-repo conflict and over-refused. The comparison normalizes trailing slashes.
    // (#1667 review)
    const a = repoOn('feat/a', { recorded: true });

    const { status, output } = runHook(
      `git -C ${a} push origin feat/a; git -C ${a}/ push origin feat/a`,
      a,
    );

    expect(status, `a trailing-slash spelling was read as a second repo:\n${output}`).toBe(0);
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

  it('does not let a MULTI-command subshell leak its cd past the close', () => {
    // `(cd <A> && npm ci); git push`: the subshell spans two statement ranges — `(cd <A>` opens
    // it, `npm ci)` closes it — so a single-statement `)` check never saw the close and the cd
    // leaked to the push. The subshell-scope save/restore discards it at the `)` in the later
    // statement; the push runs in the session dir (recorded → pass), not the unrecorded <A> the
    // subshell cd'd to. This is the finding that motivated the depth model. (#1667 review)
    const a = repoOn('feat/a');
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(`(cd ${a} && npm ci); git push origin x`, parked);

    expect(status, `a multi-command subshell leaked its cd:\n${output}`).toBe(0);
  });

  it('does not let a CLOSED subshell cd leak into a later push', () => {
    // `(cd <other>) && git push` changes no directory the push will see — the subshell cd is
    // discarded at its `)`, so the push runs in the ORIGINAL (session) dir. The subshell-scope
    // save/restore judges the session repo (recorded → pass); it does NOT judge <other>, which is
    // unrecorded and would refuse if the cd had leaked. (#1667 review)
    const parked = repoOn('feat/parked', { recorded: true });
    const other = repoOn('feat/other');

    const { status, output } = runHook(`(cd ${other}) && git push origin x`, parked);

    expect(status, `a closed subshell cd was carried into the push:\n${output}`).toBe(0);
  });

  it('a decoy cd in an env-prefix substitution does not launder the real hidden target', () => {
    // The first `cd `-shaped substring is the harmless decoy inside the env prefix's
    // substitution; locking onto it (`head -1`) left the real target's substitution
    // uninspected, and LAST_CD silently became a path bash never resolves. Every occurrence is
    // tested now, so the hidden one refuses. The backtick spelling is the one that leaked:
    // a `$( )` decoy carries `)`, which the closed-subshell tail test already refuses, and a
    // plain `$VAR` target survives words-mode into PS_SECOND's own `$` check. (#1667 review)
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(
      'V=`cd /tmp ` cd /repo`evil`/path && git push origin x',
      parked,
    );

    expect(status, 'the decoy cd laundered the substitution-bearing target').toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('does not let a SPACED closed subshell cd leak either — `( cd x ) && push`', () => {
    // Same as above with spaces: the subshell-scope save/restore discards the cd at the `)`, so
    // the push runs in the session dir (recorded → pass), never in the unrecorded <other>. (#1667)
    const parked = repoOn('feat/parked', { recorded: true });
    const other = repoOn('feat/other');

    const { status, output } = runHook(`( cd ${other} ) && git push origin x`, parked);

    expect(status, `a spaced closed subshell cd was carried into the push:\n${output}`).toBe(0);
  });

  it('a QUOTED builtin name cannot slip a hidden target past the raw inspection', () => {
    // `"cd" /repo\`evil\`/path && git push` — words-mode resolves PS_FIRST to cd, but the raw
    // pattern needs `cd ` followed by a target, and the quote glued to the builtin name breaks
    // that adjacency: RAW_TGT came back empty and the hidden-target test never ran. An empty
    // RAW_TGT on a cd statement now refuses — the target it failed to find is the one it
    // exists to inspect. (#1667 review)
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('"cd" /repo`evil`/path && git push origin x', parked);

    expect(status, 'the quoted builtin name laundered the hidden target').toBe(2);
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

  it('refuses a cd to a readable path that is not (yet) a git work tree', () => {
    // `mkdir <x> && cd <x> && git init && git push`: the hook runs before the command, so <x> is
    // readable but not a repo at hook time. `validated` mode would fall back to the declared cwd
    // (the main checkout) and judge ITS record — a false pass for a push into an unreviewed new
    // repo. The resolved-but-not-a-work-tree case now refuses. (#1667 review)
    const parked = repoOn('feat/parked', { recorded: true });
    const notARepo = makeTemp('pre-push-notrepo-');
    scratch.push(notARepo);

    const { status, output } = runHook(`cd ${notARepo} && git push origin x`, parked);

    expect(status, `a non-work-tree cd target fell back to the session checkout:\n${output}`).toBe(
      2,
    );
    expect(output).toMatch(/not a git repository/);
  });

  it('does not read a GLUED `{cd` as a brace-group cd', () => {
    // `{cd <A>; git push; }`: `{` opens a group ONLY as its own word; glued `{cd` is the command
    // `{cd`, which bash fails, leaving cwd unchanged so the push runs in the session dir. Stripping
    // `{` like `(` read it as a valid cd and judged <A> (fail-open). The glued form is ignored, so
    // the push resolves to the declared cwd (here unrecorded → refuse). (#1667 review)
    const a = repoOn('feat/a', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`{cd ${a}; git push origin x; }`, parked);

    expect(status, `a glued {cd was read as a brace-group cd:\n${output}`).toBe(2);
  });

  it('does not trust a `&&`-guarded cd that the push is not `&&`-chained to', () => {
    // `false && cd <A> ; git push`: cd <A> runs only if `false` succeeded (it never does), so the
    // push runs in the session dir — but the walk treated cd <A> as definite and judged <A>
    // (fail-open). The push is `;`-separated, not `&&`-chained to the cd, so the cd is uncertain.
    // (#1667 review)
    const a = repoOn('feat/a', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`false && cd ${a} ; git push origin x`, parked);

    expect(status, `a &&-guarded cd was trusted for a ;-separated push:\n${output}`).toBe(2);
    expect(output).toMatch(/only if a preceding/);
  });

  it('poisons the stack for a `||`-guarded pushd so a later popd inherits the uncertainty', () => {
    // `pushd <B>; false || pushd <C>; popd; git push`: the `||`-guarded pushd MIGHT have run.
    // Leaving the stack untouched let the popd confidently pop pushd <B>'s saved dir and judge it.
    // A `?` poison frame makes the popd unreadable → refuse. (#1667 review)
    const b = repoOn('feat/b', { recorded: true });
    const c = repoOn('feat/c', { recorded: true });
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(
      `pushd ${b}; false || pushd ${c}; popd; git push origin x`,
      parked,
    );

    expect(status, `a ||-guarded pushd let a later popd resolve confidently:\n${output}`).toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('poisons the stack for a `||`-guarded popd so a later popd inherits the uncertainty', () => {
    // `pushd <A>; pushd <B>; false || popd; popd; git push`: the `||`-guarded popd MIGHT have
    // consumed a frame. Leaving the stack untouched let the unconditional popd confidently pop
    // <B>'s saved dir and judge it, while the real cwd was one level further out. The guarded popd
    // now replaces the top with `?`, so the next popd reads unreadable → refuse. (#1667 review)
    const a = repoOn('feat/a', { recorded: true });
    const b = repoOn('feat/b', { recorded: true });
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(
      `pushd ${a}; pushd ${b}; false || popd; popd; git push origin x`,
      parked,
    );

    expect(status, `a ||-guarded popd let a later popd resolve confidently:\n${output}`).toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('does not carry a PIPED cd forward — it ran in a subshell', () => {
    // `cd <A> | cat; git push`: the cd is the left of a pipe, so bash runs it in a subshell and
    // the parent cwd never changes — the push lands in the ORIGINAL dir, not <A>. The walk used
    // to record <A> and validate the wrong repo. A subshell'd cd is ignored, so the push
    // resolves to the declared cwd (here a repo with no record → refuse). (#1667 review)
    const a = repoOn('feat/a', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`cd ${a} | cat; git push origin x`, parked);

    expect(status, `a piped cd was carried forward as the base:\n${output}`).toBe(2);
  });

  it('does not carry a BACKGROUNDED cd forward — it ran in a subshell', () => {
    // `cd <A> & git push`: the `&` backgrounds the cd in a subshell; the push runs in the parent
    // cwd, not <A>. (#1667 review)
    const a = repoOn('feat/a', { recorded: true });
    const parked = repoOn('feat/parked');

    const { status, output } = runHook(`cd ${a} & git push origin x`, parked);

    expect(status, `a backgrounded cd was carried forward as the base:\n${output}`).toBe(2);
  });

  it('closes the subshell even when the target path repeats in a redirection', () => {
    // `( cd <A> ) 2><A> && git push`: the target text repeats in the redirection, but the
    // subshell-scope save/restore counts the `(`/`)` on the mask and discards the cd at the `)`
    // regardless of where the path text repeats. The push runs in the session dir (recorded →
    // pass), never in the unrecorded <A> the subshell cd'd to. (#1667 review)
    const a = repoOn('feat/a');
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(`( cd ${a} ) 2>${a} && git push origin x`, parked);

    expect(status, `a repeated path leaked the subshell cd:\n${output}`).toBe(0);
  });

  it('does not carry a `||`-guarded cd forward as a definite base', () => {
    // `cd <A> || cd <B> && git push`: bash runs `cd <B>` only if `cd <A>` FAILED, so with <A>
    // present the push lands in <A> — but the linear walk carried <B> forward and judged the
    // wrong repo (the #1662 defect, under-refusing). A `||`-guarded cd is now uncertain. (#1667)
    const a = repoOn('feat/a', { recorded: true });
    const b = repoOn('feat/b', { recorded: true });

    const { status, output } = runHook(`cd ${a} || cd ${b} && git push origin feat/a`, a);

    expect(status, `a ||-guarded cd was carried forward as certain:\n${output}`).toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('refuses a cd that is BOTH `||`-guarded and pipe-subshelled (the safe superset)', () => {
    // `foo || cd <A> | cat; git push`: the cd is conditional (runs only if foo failed) AND in a
    // pipe subshell (never propagates). Taken alone the subshell fact says "ignore"; the `||`
    // fact says "uncertain, refuse". They are checked `||`-first, so this refuses — the
    // fail-closed superset. Pinned so that intended priority is explicit, not accidental. (#1667)
    const a = repoOn('feat/a', { recorded: true });
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook(`false || cd ${a} | cat; git push origin x`, parked);

    expect(status, `a ||-guarded + subshelled cd was not refused:\n${output}`).toBe(2);
    expect(output).toMatch(/cannot read/);
  });

  it('refuses a `||`-guarded push whose landing directory depends on a failure', () => {
    // `cd <A> || git push`: the push runs only if `cd <A>` failed, so it lands in the ORIGINAL
    // dir, not <A>. The walk tracked <A>; judging against it is the wrong repo. No own -C, so the
    // base is unknowable and refuses. (#1667 review)
    const a = repoOn('feat/a', { recorded: true });

    const { status, output } = runHook(`cd ${a} || git push origin x`, a);

    expect(status, 'a ||-guarded push was judged against the succeeded-branch dir').toBe(2);
    expect(output).toMatch(/preceding command failed/);
  });

  it('detects a two-repo conflict even when the FIRST push resolves to the empty base', () => {
    // No payload cwd (absence is normal), so the first `git push` resolves to the empty string —
    // the bare-push-in-session case. A `-n "$PUSH_DIR"` conflict test read that as "no push yet",
    // so a second push to a DIFFERENT repo overwrote it silently and the first went unverified. A
    // SEEN flag distinguishes "no push" from "a push whose dir is empty". (#1667 review)
    const other = repoOn('feat/other', { recorded: true });

    const { status, output } = runHook(
      `git push origin main && git -C ${other} push origin feat/other`,
      undefined,
    );

    expect(
      status,
      `the first empty-resolved push was overwritten with no conflict:\n${output}`,
    ).toBe(2);
    expect(output).toMatch(/two different repositories/);
  });

  it('follows a bare `pushd` swap back to the directory the shell began in', () => {
    // `cd <pushed> && pushd <other> && pushd && git push`: real bash's bare pushd swaps the top
    // two stack entries and cd's back to <pushed>. Treating an argument-less pushd as unreadable
    // refused this ordinary idiom; the swap now lands where bash does. (#1667 review)
    const pushed = repoOn('feat/target', { recorded: true });
    const other = repoOn('feat/other');

    const { status, output } = runHook(
      `cd ${pushed} && pushd ${other} && pushd && git push origin feat/target`,
      pushed,
    );

    expect(status, `the bare pushd swap was treated as unreadable:\n${output}`).toBe(0);
  });

  it('treats a bare `pushd` with no tracked pushd as a base it cannot read', () => {
    // Bash errors on a bare pushd with fewer than two stack entries; this walk has nothing to
    // swap, so the destination is unknown and refuses. (#1667 review)
    const parked = repoOn('feat/parked', { recorded: true });

    const { status, output } = runHook('pushd && git push origin x', parked);

    expect(status, 'a bare pushd with no prior pushd was not refused').toBe(2);
    expect(output).toMatch(/cannot read/);
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
