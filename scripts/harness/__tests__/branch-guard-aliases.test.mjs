/**
 * INFRA-085 (#1589) — a git alias is the verb it expands to.
 *
 * Every verb check in branch-guard keys off the literal subcommand, and the issue measured the
 * cost: with `alias.ci commit`, `git ci -n -m x` and `HUSKY=0 git ci -m x` both sailed past checks
 * that ask "is the verb commit". Configuring the alias is one visible command that nothing refuses,
 * and an agent that has learned a flag is refused has an obvious next move — the exact progression
 * #1588 documented.
 *
 * Fixtures configure REAL aliases in a scratch repository, because the hook resolves them from git
 * config through the scrub; a fake map would test the map.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/branch-guard.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function scratchRepo(branch, aliases = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'alias-guard-'));
  scratch.push(dir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', `--initial-branch=${branch}`, dir]);
  git('config', 'user.email', 'h@e.test');
  git('config', 'user.name', 'H');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'init');
  for (const [name, expansion] of Object.entries(aliases)) {
    git('config', `alias.${name}`, expansion);
  }
  return dir;
}

function runHook(command, cwd) {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const result = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the verb checks see through an alias', () => {
  it('reads `git ci -n` as the commit kill switch — the issue’s measured bypass', () => {
    const repo = scratchRepo('feat/x', { ci: 'commit' });

    const { status, output } = runHook('git ci -n -m x', repo);

    expect(status, 'the alias hid the -n kill switch').toBe(2);
    expect(output).toMatch(/-n/);
  });

  it('reads `HUSKY=0 git ci` as a gated statement — the second measured bypass', () => {
    const repo = scratchRepo('feat/x', { ci: 'commit' });

    const { status } = runHook('HUSKY=0 git ci -m x', repo);

    expect(status, 'the alias hid the HUSKY=0 kill switch').toBe(2);
  });

  it('reads a flag folded INTO the alias expansion', () => {
    // `alias.ci "commit -n"` carries the kill switch inside the alias, where no statement word
    // will ever show it.
    const repo = scratchRepo('feat/x', { ci: 'commit -n' });

    const { status } = runHook('git ci -m x', repo);

    expect(status, 'the expansion-borne -n went unread').toBe(2);
  });

  it('refuses an aliased push to a protected branch', () => {
    const repo = scratchRepo('main', { p: 'push' });

    const { status } = runHook('git p origin main', repo);

    expect(status, 'the aliased push was not a push to the statement checks').toBe(2);
  });

  it('leaves an aliased commit on a feature branch alone', () => {
    // The other direction: resolution must not turn ordinary aliased work into a refusal.
    const repo = scratchRepo('feat/x', { ci: 'commit' });

    const { status, output } = runHook('git ci -m "ordinary work"', repo);

    expect(status, `ordinary aliased work was refused:\n${output}`).toBe(0);
  });

  it('reads the verb PAST a global option inside the expansion', () => {
    // `-c commit.gpgsign=false commit` opens with a value-taking global; taking the literal first
    // word set the verb to `-c`, and every check keyed on `commit` — the -n cluster, HUSKY=0 —
    // went silent. The same skip the top-level latch applies must apply inside the alias.
    const repo = scratchRepo('feat/x', { aci: '-c commit.gpgsign=false commit' });

    const { status, output } = runHook('git aci -n -m x', repo);

    expect(status, `the global option inside the alias hid the verb:\n${output}`).toBe(2);
  });

  it('resolves a CHAINED alias to the verb at the end of the chain', () => {
    // `alias.a1 ci` over `alias.ci commit`: single-level resolution classified `a1` as `git ci`,
    // which matches no action regex, so the statement was judged as nothing at all.
    const repo = scratchRepo('feat/x', { ci: 'commit', a1: 'ci' });

    const { status, output } = runHook('git a1 -n -m x', repo);

    expect(status, `the chained alias went unclassified:\n${output}`).toBe(2);
  });

  it('a chained alias still passes as ordinary work without a kill switch', () => {
    const repo = scratchRepo('feat/x', { ci: 'commit', a1: 'ci' });

    const { status, output } = runHook('git a1 -m "ordinary work"', repo);

    expect(status, `ordinary chained-alias work was refused:\n${output}`).toBe(0);
  });

  it('a SELF-REFERENTIAL alias cannot loop the resolver', () => {
    // The chain is bounded; a cycle stops flattening rather than hanging the hook.
    const repo = scratchRepo('feat/x', { loop: 'loop' });

    const { status } = runHook('git loop', repo);

    expect(status).toBe(0);
  });

  it('reads the SPACE form of core.hooksPath folded into an alias', () => {
    // `git config core.hooksPath /dev/null` sets the key with no `=` anywhere, and the two-word
    // state machine that catches it lives in the statement loop — which never sees the words
    // inside an expansion. `git dh` disabled the hooks and nothing refused it.
    const repo = scratchRepo('feat/x', { dh: 'config core.hooksPath /dev/null' });

    const { status, output } = runHook('git dh', repo);

    expect(status, `the aliased space-form hooksPath assignment walked through:\n${output}`).toBe(
      2,
    );
  });

  it('reads a hooksPath VALUE typed after an alias that ends on the key', () => {
    // The expansion arms the machine; the value arrives as a statement word.
    const repo = scratchRepo('feat/x', { dh: 'config core.hooksPath' });

    const { status } = runHook('git dh /dev/null', repo);

    expect(status, 'the split-across-the-alias assignment walked through').toBe(2);
  });

  it('reads an aliased `git rm` against a hook as destruction', () => {
    // The husky block scans literal words: the whitelist read `git`, the (rm|mv) pattern read
    // `wipe`, and the hook file deleted without a refusal.
    const repo = scratchRepo('feat/x', { wipe: 'rm' });

    const { status, output } = runHook('git wipe -f .husky/pre-push', repo);

    expect(status, `the aliased rm deleted a hook unchallenged:\n${output}`).toBe(2);
  });

  it('does not classify an aliased `branch -d` as a branch CREATION', () => {
    // RE_CREATE matches `branch -d` first and the statement path excludes it after; the alias
    // classification skipped the exclusions, so `git bd old` ran the unmerged-branch network
    // check on a deletion.
    const repo = scratchRepo('feat/x', { bd: 'branch -d' });
    execFileSync('git', ['-C', repo, 'branch', 'old-twig'], { encoding: 'utf8' });

    const { status, output } = runHook('git bd old-twig', repo);

    expect(status, `an aliased deletion was judged as a creation:\n${output}`).toBe(0);
  });

  it("does not read a message VALUE of '-n' as the kill switch", () => {
    // `-m`'s value is whatever follows it, inside the expansion as in the statement.
    const repo = scratchRepo('feat/x', { ci: 'commit -m -n' });

    const { status, output } = runHook('git ci', repo);

    expect(status, `a message value was read as a flag:\n${output}`).toBe(0);
  });

  it('reads a create flag typed at the CALL SITE of a verb-only alias', () => {
    // `alias.co checkout` carries no flag, so no per-action classification of the alias alone
    // could see `git co -b <name>` as a creation — the flag lives in the statement. Substituting
    // the expansion into the statement mask reads them together, and the base/name checks fire.
    const repo = scratchRepo('feat/x', { co: 'checkout' });

    const { status, output } = runHook('git co -b feat/call-site-flag main', repo);

    expect(status, `the call-site -b was invisible to the checks:\n${output}`).toBe(2);
  });

  it('refuses the COPY forms through an alias, as the literal spelling is refused', () => {
    // `alias.bc "branch -c"`: neither a create (excluded) nor the literal copy pattern (the word
    // is `bc`), so it matched neither and passed through the guard entirely — the failure this
    // file names as the worst one.
    const repo = scratchRepo('feat/x', { bc: 'branch -c' });
    execFileSync('git', ['-C', repo, 'branch', 'old-twig'], { encoding: 'utf8' });

    const { status, output } = runHook('git bc old-twig new-twig', repo);

    expect(status, `the aliased copy form passed through:\n${output}`).toBe(2);
  });

  it('substitutes past ANY value-taking global before the alias, = form included', () => {
    // The (-C|-c)-only prefix left `git --git-dir=.git ci` unsubstituted: the mask kept `ci`,
    // IS_COMMIT stayed false, and a commit ON A PROTECTED BRANCH took no check at all — the
    // protected-branch refusal is mask-driven, so it isolates the substitution from the latch.
    const repo = scratchRepo('develop', { ci: 'commit' });

    const { status, output } = runHook('git --git-dir=.git ci -m x', repo);

    expect(status, `a non-(-c|-C) global before the alias skipped every check:\n${output}`).toBe(2);
  });

  it('keeps looking for the verb when an alias expands to GLOBALS ONLY', () => {
    // `alias.q "-c advice.pushNonFastForward=false"`: the expansion has no head, and falling
    // back to its first word latched `-c` as the verb — the real verb typed after the alias was
    // never read, and its kill switch sailed past every check keyed on `commit`.
    const repo = scratchRepo('feat/x', { q: '-c advice.pushNonFastForward=false' });

    const { status, output } = runHook('git q commit -n -m x', repo);

    expect(status, `the globals-only alias froze the verb as a flag:\n${output}`).toBe(2);
  });

  it("reads a -C statement's aliases from THAT repository", () => {
    // The session repo has no alias; the -C target defines alias.ci = commit locally. Resolving
    // aliases only from the session repo missed it, and the kill switch rode through.
    const session = scratchRepo('feat/session');
    const other = scratchRepo('feat/x', { ci: 'commit' });

    const { status, output } = runHook(`git -C ${other} ci -n -m x`, session);

    expect(status, `the -C repo's local alias was invisible:\n${output}`).toBe(2);
  });

  it('a GLOB in an alias value stays a refspec, not the files in the CWD', () => {
    // git tokenizes alias values itself and never globs; an unquoted bash split expanded
    // `*:*` (a push-all refspec) against the hook process directory, replacing the refspec
    // word with matching FILENAMES. The hook is spawned IN a directory holding a matching file
    // so the expansion class is exercised. PINS the verdict rather than red-proving it: no
    // constructed expansion flipped a verdict pre-fix (the mangled words did not carry the
    // decision), so this guards the set -f class fix against regression, not a measured flip.
    const repo = scratchRepo('feat/x', { pa: 'push origin *:*' });
    writeFileSync(path.join(repo, 'a:b'), '');
    const payload = JSON.stringify({
      tool_name: 'Bash',
      cwd: repo,
      tool_input: { command: 'git pa --no-verify' },
    });
    const result = spawnSync('bash', [HOOK], {
      input: payload,
      encoding: 'utf8',
      cwd: repo,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });

    expect(
      result.status,
      `the glob in the alias value derailed the checks:\n${result.stdout}${result.stderr}`,
    ).toBe(2);
  });

  it('judges a creation behind a NON-(-c|-C) global all the way to the base check', () => {
    // RE_CREATE was widened to see past --git-dir, but the name/base EXTRACTIONS still
    // tolerated only -C/-c (the space-separated value form is the gap; an =-glued global reads
    // as a plain flag) — a detected creation whose name could not be read skipped the
    // naming and base checks entirely.
    const repo = scratchRepo('feat/x', { co: 'checkout' });

    const { status, output } = runHook('git --git-dir .git co -b feat/wide-globals main', repo);

    expect(status, `the extraction lost the creation behind the global:\n${output}`).toBe(2);
  });

  it('finds the -C behind another global, and reads THAT repo aliases', () => {
    // hook_git_c_path skipped only `-c <pair>` prefixes, so `--work-tree=. -C <repo>` hid the
    // -C from every consumer — the statement's aliases and branch were judged in the session
    // repo instead.
    const session = scratchRepo('feat/session');
    const other = scratchRepo('feat/x', { ci: 'commit' });

    const { status, output } = runHook(`git --work-tree=. -C ${other} ci -n -m x`, session);

    expect(status, `the -C behind a global was invisible:\n${output}`).toBe(2);
  });

  it('reads an aliased remote-branch DELETE — the verb the delete gate greps for', () => {
    // `hook_deleted_branch` pattern-matches the literal `git push … --delete <name>`. With
    // `alias.pd "push origin --delete"` those words exist only in the expansion, so the gate
    // must read the substituted statement, not the raw command. The scratch repo has no
    // resolvable PR state, and "cannot confirm" is a refusal by design.
    const repo = scratchRepo('feat/x', { pd: 'push origin --delete' });

    const { status, output } = runHook('git pd feat/other', repo);

    expect(status, `the aliased --delete never reached the delete gate:\n${output}`).toBe(2);
    expect(output).toMatch(/feat\/other/);
  });

  it('leaves a SHELL alias alone — the stated gap, stated here too', () => {
    // `!…` expansions are arbitrary shell, not a git verb; classifying them would mean parsing
    // shell inside git config. Invisible to the verb checks, exactly as before the fix.
    const repo = scratchRepo('feat/x', { sh: '!echo hello' });

    const { status } = runHook('git sh', repo);

    expect(status).toBe(0);
  });
});
