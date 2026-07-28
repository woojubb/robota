import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * What a guard EXAMINES must be what will RUN.
 *
 * Reachability — does the hook fire at all — is the sibling question, pinned next door. This file
 * asks the one after it: once fired, is the hook looking at the command? Three ways it was not,
 * each measured on 2026-07-28 against the hooks as they then stood:
 *
 *   1. Every hook decoded the payload with `grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"'`,
 *      which stops at the first double quote INSIDE the command. `echo "go" && git push origin
 *      main` was read as `echo `, so branch-guard let a push to a protected branch through. Four
 *      hooks carried the same copy.
 *   2. `worktree-cwd-guard` scanned `${COMMAND%%<<*}` — everything from the first heredoc opener
 *      onward discarded — so `git reset --hard` written after a CLOSED heredoc was invisible.
 *   3. The opposite error is equally real: reading a heredoc BODY treats prose as a command, and a
 *      commit message describing `git checkout -b` self-blocked a whole session.
 *
 * A guard reading a truncated command is not a weaker guard; it is a guard judging something other
 * than what will run, which `enforcement-architecture.md` names as the defect to prevent. The
 * shapes below are the contract for `lib/command-scan.sh` and for every hook that uses it.
 */

/** Scratch repos created during the run, removed in `afterAll` so probes leave no litter. */
const scratchRoots = [];

afterAll(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway repository for the hook to judge, on a named branch.
 *
 * Never the real working tree: these probes make guards run their real work against whatever
 * `CLAUDE_PROJECT_DIR` points at, and the verdict would then depend on a developer's local state.
 */
function scratchRepo(branch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-parse-'));
  scratchRoots.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

/**
 * `spawnSync`, not `execFileSync`: hooks speak on stderr, and `execFileSync`'s success path returns
 * stdout only — a hook that spoke and exited 0 would read as silence, which once produced a
 * reported bypass that was not there.
 */
function runHook(hookFile, command, { cwd, env = {} } = {}) {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hookFile)], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('a hook examines the command that will run', () => {
  it('sees a guarded verb that follows a quoted argument', () => {
    // The HARNESS-061 shape. Measured against the pre-fix hook: exit 0, silent — a push to a
    // protected branch waved through because the decoder stopped at `echo "`.
    const cwd = scratchRepo('main');
    const result = runHook('branch-guard.sh', 'echo "starting release" && git push origin main', {
      cwd,
    });

    expect(
      result.status,
      'branch-guard let a push to `main` through because the command was truncated at the first ' +
        'quote. Decode the payload as JSON; do not read it with grep.',
    ).toBe(2);
    expect(result.output).toMatch(/protected branch/);
  });

  it('sees a destructive command written after a closed heredoc', () => {
    // The `%%<<*` shape: truncating at the first opener threw away the rest of the command.
    const cwd = scratchRepo('main');
    const command = [
      'git commit -F- <<EOF',
      'a message',
      'EOF',
      'git reset --hard origin/main',
    ].join('\n');
    const result = runHook('worktree-cwd-guard.sh', command, {
      cwd,
      env: { ROBOTA_AGENT_WORKTREE: '1' },
    });

    expect(
      result.status,
      'worktree-cwd-guard did not see a `git reset --hard` that follows a closed heredoc. ' +
        'Strip heredoc BODIES; keep what comes after the terminator.',
    ).toBe(2);
  });

  it('does not read a heredoc body as a command', () => {
    // The opposite error, and the one that cost a session: prose describing a command is not the
    // command. A guard that cannot tell them apart blocks its own author.
    const cwd = scratchRepo('main');
    const cases = [
      {
        hook: 'branch-guard.sh',
        env: {},
        command: ['git log --oneline <<EOF', 'then run git push origin main', 'EOF'].join('\n'),
      },
      {
        hook: 'worktree-cwd-guard.sh',
        env: { ROBOTA_AGENT_WORKTREE: '1' },
        command: ['git commit -F- <<EOF', 'we ran git reset --hard once', 'EOF'].join('\n'),
      },
    ];

    for (const { hook, command, env } of cases) {
      const result = runHook(hook, command, { cwd, env });
      expect(result.status, `${hook} read a heredoc body as a command`).toBe(0);
      expect(result.output.trim(), `${hook} spoke about text inside a heredoc`).toBe('');
    }
  });

  it('reads a quoted argument as text, not as a command', { timeout: 120_000 }, () => {
    // The mirror image, and the one that BLOCKS. `pre-push-check`'s own comment recorded this trap
    // as latent — unreachable only because the decoder truncated at the first quote — and predicted
    // it would come alive the day the decode was fixed. It was fixed here, so it is live here.
    // `gh pr create --body "...; git push later"` performs no push, and a guard that stops it is a
    // guard stopping its own author, which is the failure this whole PR exists to end.
    const cwd = scratchRepo('main');
    const mention = 'gh pr create --body "notes; git push later"';

    for (const hook of ['branch-guard.sh', 'pre-push-check.sh']) {
      const result = runHook(hook, mention, { cwd });
      expect(result.status, `${hook} treated a quoted mention of a push as a push`).toBe(0);
    }
  });

  it('still reads a command a shell is told to run', { timeout: 120_000 }, () => {
    // The limit of the rule above, and why it cannot be "ignore anything in quotes": `bash -c` runs
    // its string. Blanking that content would convert a false positive into a bypass, which is the
    // one direction a guard must never trade in.
    const cwd = scratchRepo('main');
    const result = runHook('branch-guard.sh', 'bash -c "git push origin main"', { cwd });

    expect(result.status, 'branch-guard missed a push inside `bash -c`').toBe(2);
    expect(result.output).toMatch(/protected branch/);
  });

  it('does not let a quoted mention choose which repository is judged', () => {
    // The asymmetry review caught after the first pass: verb detection ignored quoted contents while
    // the `git -C` extraction — which decides WHICH repository the branch check runs against — still
    // read them. A commit message naming another checkout redirected the guard there, and a push to
    // a protected branch went through silently. Worse than the false positive it sat beside.
    const protectedRepo = scratchRepo('main');
    const elsewhere = scratchRepo('feat/elsewhere');
    const result = runHook(
      'branch-guard.sh',
      `git commit -m "note git -C ${elsewhere} here" && git push origin main`,
      { cwd: protectedRepo },
    );

    expect(
      result.status,
      'a `git -C` written inside a quoted argument redirected the branch check at another ' +
        'repository. Locate the flag in a masked command; read its value from the original.',
    ).toBe(2);
  });

  it('still reads a real -C target, quoted or not', () => {
    // The other half, and why the mention case cannot be fixed by blanking quotes here: a path is
    // routinely quoted, and a guard that loses it judges the wrong repository in the other
    // direction. Both spellings must resolve to the same checkout.
    const cwd = scratchRepo('main');
    const elsewhere = scratchRepo('feat/elsewhere');

    for (const target of [elsewhere, `"${elsewhere}"`]) {
      const result = runHook('branch-guard.sh', `git -C ${target} push origin feat/elsewhere`, {
        cwd,
      });
      expect(result.status, `branch-guard judged the wrong repository for -C ${target}`).toBe(0);
    }
  });

  it('reads a command an interpreter is told to run', () => {
    // `bash -c` was the entire exception list, and `python3 -c` / `node -e` run their strings just
    // as truly. Masking theirs converted the false positive that masking removed into a bypass,
    // which is the trade a guard may never make.
    const cwd = scratchRepo('main');
    const cases = [
      `python3 -c "import os; os.system('git push origin main')"`,
      `node -e "sh('git push origin main')"`,
    ];

    for (const command of cases) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard missed a push inside: ${command}`).toBe(2);
    }
  });

  it('masks a quoted argument that spans lines', () => {
    // The masking was `sed`, which works a line at a time, so an argument opened on one line and
    // closed on the next was never masked — and a second line reading `git push` blocked an
    // ordinary commit. Multi-line messages are exactly where that text appears.
    const cwd = scratchRepo('feat/probe');
    const result = runHook(
      'branch-guard.sh',
      'git commit -m "line one\nthen git push origin main"',
      {
        cwd,
      },
    );

    expect(result.status, 'a push named on the second line of a message was read as a push').toBe(
      0,
    );
  });

  it('refuses rather than falls silent when it cannot decode', () => {
    // The regression review caught: routing tool_name through the JSON decoders meant a machine
    // with neither jq nor python3 produced an empty tool name, every hook took its "not a Bash
    // call" branch, and three guards switched off without a word. Measured before the fix: exit 0.
    const cwd = scratchRepo('main');
    const bin = mkdtempSync(path.join(tmpdir(), 'hook-nojson-'));
    scratchRoots.push(bin);
    for (const tool of ['bash', 'dirname', 'grep', 'sed', 'awk', 'head', 'tr', 'cat', 'git']) {
      const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
      const target = (found.stdout ?? '').trim();
      if (target) symlinkSync(target, path.join(bin, tool));
    }

    for (const hook of ['branch-guard.sh', 'worktree-cwd-guard.sh']) {
      const result = runHook(hook, 'git push origin main', {
        cwd,
        env: { PATH: bin, ROBOTA_AGENT_WORKTREE: '1' },
      });
      expect(result.status, `${hook} passed silently with no JSON decoder available`).not.toBe(0);
      expect(result.output, `${hook} refused without saying why`).toMatch(/could not be decoded/);
    }
  });

  it('reads a -C target inside a string an interpreter runs', () => {
    // The interpreter exception kept `bash -c \"git push\"` visible to verb detection but not to the
    // `-C` extraction, so the branch check judged some other directory while the real target went
    // unexamined. Verb and target must be read out of the same string.
    const protectedRepo = scratchRepo('main');
    const cwd = scratchRepo('feat/elsewhere');
    const result = runHook(
      'branch-guard.sh',
      `bash -c "git -C ${protectedRepo} push origin main"`,
      {
        cwd,
      },
    );

    expect(
      result.status,
      'the `-C` target inside an interpreter string was masked away, so the guard judged the ' +
        'wrong repository and let a push to a protected branch through.',
    ).toBe(2);
  });

  it('exempts only the string the interpreter runs', () => {
    // Applying the exception to the whole command meant one `bash -c` anywhere unmasked every other
    // quoted argument on the line, and an ordinary commit whose message mentioned a push was read
    // as a push. Each quoted string answers for itself.
    const cwd = scratchRepo('feat/probe');
    const command = 'bash -c "echo hi" && git commit -m "dont run git push in CI"';

    for (const hook of ['branch-guard.sh', 'pre-push-check.sh']) {
      const result = runHook(hook, command, { cwd });
      expect(result.status, `${hook} read an unrelated message as a command`).toBe(0);
    }
  });

  it('does not mistake a herestring for a heredoc', () => {
    // `<<< \"x\"` has no body and no terminator, but the opener pattern matched from the second `<`,
    // so every line after it was swallowed as body and never came back — one Bash call, and the
    // command that mattered was the one nobody looked at. A new instance of the exact class this
    // whole change exists to close, and green until this case existed.
    const cwd = scratchRepo('main');
    const command = 'cat <<< \"x\"\ngit push --force origin main';

    for (const [hook, env] of [
      ['branch-guard.sh', {}],
      ['worktree-cwd-guard.sh', { ROBOTA_AGENT_WORKTREE: '1' }],
    ]) {
      const result = runHook(hook, command, { cwd, env });
      expect(result.status, `${hook} lost every command after a herestring`).toBe(2);
    }
  });

  it('reads what eval and command substitution will run', () => {
    // `eval \"...\"` is the plainest way a shell runs a string, and it fell out of the interpreter
    // list when that expression was rewritten — a regression introduced by a fix. `$(...)` and
    // backticks run whatever the surrounding quotes are, so a masked region containing them hides a
    // real command.
    const cwd = scratchRepo('main');
    const cases = ['eval "git push --force origin main"', 'echo "$(git push origin main)"'];

    for (const command of cases) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard missed a push in: ${command}`).toBe(2);
    }
  });

  it('reads a new branch name from the checkout that creates it', () => {
    // The extraction ran a greedy `.*` over the whole command and took whatever followed the LAST
    // -b/-B/-c/-C, so a later `git -C /other` supplied the \"branch name\" and a correctly named
    // branch was refused. Worktree-parallel work puts those two in one command routinely.
    const cwd = scratchRepo('develop');
    const elsewhere = scratchRepo('main');
    const result = runHook(
      'branch-guard.sh',
      `git checkout -b feat/x && git -C ${elsewhere} status`,
      {
        cwd,
      },
    );

    expect(result.status, 'a `-C` path was read as the new branch name').toBe(0);
  });

  it('does not read a delete named in a message as a delete', () => {
    // The last pair still scanning unmasked text after every other check had moved off it. A commit
    // message quoting `--delete-branch` refused the commit — the same class this change closes
    // everywhere else, left in the two places that reach out to `gh` before refusing.
    const cwd = scratchRepo('feat/probe');
    const cases = [
      'git commit -m "example: gh pr merge --delete-branch"',
      'git commit -m "e.g. git push origin --delete old-branch"',
      'git commit -m "she said \\"hi\\"" && git commit -m x',
    ];

    for (const command of cases) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard read a quoted mention as a delete: ${command}`).toBe(0);
    }
  });

  it('still refuses a real delete', () => {
    // The other half. `--delete-branch` once removed the develop integration branch, and a remote
    // delete is refused until a merged PR is confirmed — neither may be lost to the masking above.
    const cwd = scratchRepo('feat/probe');

    for (const command of [
      'gh pr merge 1 --merge --delete-branch',
      'git push origin --delete some-branch',
    ]) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard let a real delete through: ${command}`).toBe(2);
    }
  });

  it('refuses a payload that names no tool', () => {
    // The fail-open moved to the call site: left bare, a non-zero return aborts the assignment under
    // `set -e` and the hook exits 1 saying nothing — which the hook protocol treats as non-blocking.
    // The same conflation the decode path already refuses, one line further out.
    const cwd = scratchRepo('main');
    const payload = JSON.stringify({ tool_input: { command: 'git push origin main' } });

    for (const hook of ['branch-guard.sh', 'pre-push-check.sh', 'worktree-cwd-guard.sh']) {
      const result = spawnSync('bash', [path.join(HOOKS_DIR, hook)], {
        input: payload,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ROBOTA_AGENT_WORKTREE: '1' },
      });
      expect(result.status, `${hook} exited non-blocking on a payload with no tool_name`).toBe(2);
      expect(`${result.stderr}`, `${hook} refused without saying why`).toMatch(/names no tool/);
    }
  });

  it('sees a delete however the flag is ordered', () => {
    // `git push --delete <remote> <branch>` is accepted by git and was never matched — pre-existing,
    // and a delete the guard misses is a delete it permits.
    const cwd = scratchRepo('feat/probe');

    for (const command of ['git push origin --delete gone', 'git push --delete origin gone']) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard let a delete through: ${command}`).toBe(2);
    }
  });

  it('names the branch the delete actually targets', () => {
    // The `gh api` path read the first `/git/refs/heads/…` anywhere in the raw command, so a decoy
    // in a quoted commit message stood in for the real target and the protected-branch and
    // merged-PR checks were run against a branch nobody was deleting. The verb was judged in the
    // mask; only the value was not position-mapped to it.
    const cwd = scratchRepo('feat/probe');
    const command =
      'git commit -m "note /git/refs/heads/scratch" && ' +
      'gh api -X DELETE repos/o/r/git/refs/heads/develop';
    const result = runHook('branch-guard.sh', command, { cwd });

    expect(result.status, 'a decoy branch name displaced the real delete target').toBe(2);
    expect(result.output, 'the refusal named the decoy, not the branch being deleted').toMatch(
      /develop/,
    );
  });

  it('reads strings run by wrappers, not only by bash', () => {
    // A closed interpreter list is a list of the ways past the guard. `ssh`, `expect`, `timeout`
    // and any shell-named wrapper run their strings; masking them made a precise guard a blind one.
    const cwd = scratchRepo('main');
    const cases = [
      'ssh host "git push --force origin main"',
      'timeout 5 bash -c "git push origin main"',
      // A NAMED shell, not an arbitrary token ending in `sh`. Matching `[^/]*sh` covered unknown
      // wrappers but also read `git stash push -m "…"` as an interpreter and refused it. The
      // boundary is stated in command-scan.sh: a string run by something outside the list is
      // masked, and that is the price of not refusing ordinary commands.
      'fish -c "git push origin main"',
      'ksh -c "git push origin main"',
      // More than one argument between the interpreter and its string. Allowing exactly one meant
      // every one of these fell out of the exception and was masked — the bypass class this
      // exception exists to close, reopened by the shape of the expression rather than the list.
      'bash -x -c "git push origin main"',
      'ssh -o StrictHostKeyChecking=no host "git push origin main"',
      'python3 -u -c "os.system(1); git push origin main"',
      '/bin/bash -c "git push origin main"',
    ];

    for (const command of cases) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard missed a push in: ${command}`).toBe(2);
    }
  });

  it('still says nothing about a search for those words', () => {
    // The boundary the widened list must not cross. `rg "git push" docs/` is ordinary work here,
    // and reading its argument as a command would refuse routine commands many times a day — the
    // self-blocking these hooks have already inflicted once.
    const cwd = scratchRepo('main');

    for (const command of ['rg "git push" docs/', 'grep -rn "git push --force" .']) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard blocked a search: ${command}`).toBe(0);
    }
  });

  it('refuses a payload carrying no command', () => {
    // jq's `// ""` made an absent field decode "successfully" as empty, which then matched nothing
    // — a silent pass wearing the costume of a clean scan.
    const cwd = scratchRepo('main');
    const payload = JSON.stringify({ tool_name: 'Bash', tool_input: {} });

    for (const hook of ['branch-guard.sh', 'worktree-cwd-guard.sh']) {
      const result = spawnSync('bash', [path.join(HOOKS_DIR, hook)], {
        input: payload,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ROBOTA_AGENT_WORKTREE: '1' },
      });
      expect(result.status, `${hook} passed a payload with no command`).toBe(2);
    }
  });

  it('scans a MultiEdit the same as an Edit', () => {
    // The bug this hook's own comment records — MultiEdit carries its replacements in an `edits`
    // array, so neither field the extraction read existed, content came back empty and the hook
    // passed content it refuses from Edit. The fix went in without a case that sends an actual
    // MultiEdit payload, so it could regress to silently unscanned and stay green: the
    // accidental-green shape this repo has a rule against.
    const cwd = scratchRepo('main');
    const src = path.join(cwd, 'packages/p/src');
    mkdirSync(src, { recursive: true });
    const forbidden = 'try {\n  go();\n} catch (e) {\n  return 0;\n}\n';

    const payloads = [
      {
        tool_name: 'Edit',
        tool_input: { file_path: path.join(src, 'a.ts'), new_string: forbidden },
      },
      {
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: path.join(src, 'a.ts'),
          edits: [{ old_string: 'x', new_string: forbidden }],
        },
      },
    ];

    for (const payload of payloads) {
      const result = spawnSync('bash', [path.join(HOOKS_DIR, 'check-forbidden-patterns.sh')], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      });
      expect(result.status, `${payload.tool_name} content went unscanned`).toBe(2);
    }
  });

  it('is registered for every tool whose content it scans', () => {
    // Reading the content was only half the bypass: MultiEdit was also absent from the hook's
    // matcher, so the handling could not run at all. Unguarded twice over — once by shape, once by
    // registration — and the second half is invisible to any test that invokes the hook directly.
    const settings = JSON.parse(
      readFileSync(path.join(WORKSPACE_ROOT, '.claude/settings.json'), 'utf8'),
    );
    const matchers = (settings.hooks?.PreToolUse ?? [])
      .filter((entry) =>
        (entry.hooks ?? []).some((h) => `${h.command}`.includes('check-forbidden-patterns')),
      )
      .map((entry) => entry.matcher ?? '');

    expect(matchers.length, 'check-forbidden-patterns is not registered at all').toBeGreaterThan(0);
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      expect(
        matchers.some((m) => m.split('|').includes(tool)),
        `check-forbidden-patterns never runs for ${tool}, so its handling of it cannot fire`,
      ).toBe(true);
    }
  });

  it('refuses an edit it cannot read', () => {
    // check-forbidden-patterns guards a different tool and was left out of this PR's fail-closed
    // pass. Its FIRST field came from bare jq, so a machine without jq read an empty file path and
    // exited 0 before any check ran — the same silent bypass, in the one hook nobody was looking at.
    const cwd = scratchRepo('main');
    const src = path.join(cwd, 'packages/p/src');
    mkdirSync(src, { recursive: true });
    const payload = JSON.stringify({
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(src, 'a.ts'),
        new_string: 'try {\n  go();\n} catch (e) {\n  return 0;\n}\n',
      },
    });

    // A PATH with neither jq nor python3 on it — the condition the ladder exists for.
    const bin = mkdtempSync(path.join(tmpdir(), 'hook-nojson-edit-'));
    scratchRoots.push(bin);
    for (const tool of [
      'bash',
      'dirname',
      'grep',
      'sed',
      'awk',
      'head',
      'tr',
      'cat',
      'date',
      'mkdir',
      'cut',
    ]) {
      const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
      const target = (found.stdout ?? '').trim();
      if (target) symlinkSync(target, path.join(bin, tool));
    }

    const result = spawnSync('bash', [path.join(HOOKS_DIR, 'check-forbidden-patterns.sh')], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin, CLAUDE_PROJECT_DIR: cwd },
    });

    expect(result.status, 'check-forbidden-patterns passed an edit it could not read').toBe(2);
  });

  it('does not let a quoted mention disarm an override', () => {
    // Overrides were the last check reading unmasked text. `git commit -m \"note:
    // BRANCH_GUARD_ALLOW_DELETE=1 was tried\" && git push origin --delete develop` set the override
    // from inside the message and skipped the protected-branch refusal — the guard that exists
    // because develop was once deleted by accident, switched off by prose.
    const cwd = scratchRepo('feat/probe');
    const result = runHook(
      'branch-guard.sh',
      'git commit -m "note: BRANCH_GUARD_ALLOW_DELETE=1 was tried" && git push origin --delete develop',
      { cwd },
    );

    expect(result.status, 'a quoted mention switched the delete guard off').toBe(2);
    expect(result.output).toMatch(/protected branch/);
  });

  it('sees a substitution written after an escaped quote', () => {
    // Escapes had a test and substitution had a test; both in one string had none, and that is
    // exactly where the lookahead broke. It stopped at the first `\\"` inside the argument, so a
    // real `$(...)` after one was never seen, the region was masked, and the command bash actually
    // runs vanished from the scan.
    const cwd = scratchRepo('main');
    const result = runHook(
      'branch-guard.sh',
      'git commit -m "note \\"x\\" $(git push --force origin main)"',
      { cwd },
    );

    expect(result.status, 'a push inside a substitution went unseen after an escaped quote').toBe(
      2,
    );
  });

  it('accepts a quoted branch name', () => {
    // The new-branch name was pulled straight out of the MASKED text, so a quoted name came back as
    // the \\001 fill and a correctly named branch was refused. Position in the mask, value from the
    // original — the rule the other two extractions already follow.
    const cwd = scratchRepo('develop');

    for (const command of ['git checkout -b "feat/my-branch"', 'git checkout -b feat/my-branch']) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard refused a well-named branch: ${command}`).toBe(0);
    }

    const bad = runHook('branch-guard.sh', 'git checkout -b BAD_NAME', { cwd });
    expect(bad.status, 'branch-guard stopped checking names altogether').toBe(2);
  });

  it('reads a quoted verb as the verb it is', () => {
    // Quoting a bare word changes nothing about what the shell runs, so `git \"push\"` must read
    // exactly as `git push`. Masking every quoted region by default made all of these invisible —
    // and quoting each token is ordinary defensive shell style, so this was reachable by habit,
    // not only by someone routing around the guard.
    const cwd = scratchRepo('main');
    const cases = [
      { hook: 'branch-guard.sh', env: {}, command: 'git \"push\" origin main' },
      { hook: 'branch-guard.sh', env: {}, command: "git 'push' origin main" },
      { hook: 'branch-guard.sh', env: {}, command: 'git \"commit\" -m x' },
      { hook: 'branch-guard.sh', env: {}, command: 'gh pr merge 1 --merge \"--delete-branch\"' },
      {
        hook: 'worktree-cwd-guard.sh',
        env: { ROBOTA_AGENT_WORKTREE: '1' },
        command: 'git reset \"--hard\" origin/main',
      },
    ];

    for (const { hook, command, env } of cases) {
      const result = runHook(hook, command, { cwd, env });
      expect(result.status, `${hook} did not see a quoted verb: ${command}`).toBe(2);
    }
  });

  it('restores only the substitution, not the message around it', () => {
    // Keeping the WHOLE quoted string once it contained a substitution meant an ordinary message
    // holding both `$(...)` and an unrelated mention of a guarded verb was read as that verb. Only
    // the substitution's own span runs, so only that span is restored.
    const cwd = scratchRepo('feat/probe');
    const result = runHook(
      'branch-guard.sh',
      'git commit -m \"Bumps $(cat VERSION); prose about git push\"',
      { cwd },
    );

    expect(result.status, 'prose beside a substitution was read as a command').toBe(0);
  });

  it('sees a backtick subshell', () => {
    // `$(...)` was covered because `(` sits in every boundary set; the backtick spelling of the same
    // substitution had no boundary character at all, so the verb right after it matched nothing.
    // Closing one spelling of a construct and leaving the other is the asymmetry, not the depth.
    const cwd = scratchRepo('main');
    const cases = [
      { hook: 'branch-guard.sh', env: {}, command: 'echo `git push origin main`' },
      {
        hook: 'worktree-cwd-guard.sh',
        env: { ROBOTA_AGENT_WORKTREE: '1' },
        command: 'echo `git reset --hard origin/main`',
      },
    ];

    for (const { hook, command, env } of cases) {
      const result = runHook(hook, command, { cwd, env });
      expect(result.status, `${hook} missed a backtick subshell: ${command}`).toBe(2);
    }
  });

  it('does not mistake a token ending in sh for a shell', () => {
    // `[^ /]*sh` matched `stash`, `squash`, `wash`. `git stash push -m \"…\"` therefore read `stash`
    // as an interpreter, opened its message to verb scanning, and refused an ordinary command.
    const cwd = scratchRepo('feat/probe');
    const result = runHook('branch-guard.sh', 'git stash push -m "wip before git push to main"', {
      cwd,
    });

    expect(result.status, 'branch-guard read a stash message as a push').toBe(0);
  });

  it('reaches a push introduced by a plain word', () => {
    // pre-push-check alone kept whitespace out of its boundary set, so `time git push`,
    // `command git push` and `nice git push` never reached it and skipped branch-hygiene and
    // lockfile checks entirely. The exclusion existed for a false positive that masking has since
    // removed — the same reachability gap this PR fixes twice over, left in the third hook.
    const cwd = scratchRepo('feat/probe');

    for (const command of [
      'time git push origin feat/probe',
      'command git push origin feat/probe',
      'nice git push origin feat/probe',
    ]) {
      const result = runHook('pre-push-check.sh', command, { cwd });
      expect(result.output.trim().length, `pre-push-check never saw: ${command}`).toBeGreaterThan(
        0,
      );
    }
  });

  it('reports a repo-relative path for a file outside the project dir', () => {
    // The scope filter was widened to accept any prefix so worktree paths would be checked, but the
    // strip that makes a path repo-relative still assumed the file sat under CLAUDE_PROJECT_DIR. A
    // path that does not survived whole, so the refusal and blocks.jsonl printed an absolute path —
    // in exactly the scenario the widening was for.
    const projectDir = scratchRepo('main');
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'hook-elsewhere-'));
    scratchRoots.push(elsewhere);
    const file = path.join(elsewhere, 'packages/p/src/a.ts');
    mkdirSync(path.dirname(file), { recursive: true });

    const result = spawnSync('bash', [path.join(HOOKS_DIR, 'check-forbidden-patterns.sh')], {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: {
          file_path: file,
          new_string: 'try {\n  go();\n} catch (e) {\n  return 0;\n}\n',
        },
      }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });

    expect(result.status, 'the forbidden pattern was not caught at all').toBe(2);
    expect(`${result.stderr}`, 'an absolute path leaked into the refusal').toContain(
      'packages/p/src/a.ts',
    );
    expect(`${result.stderr}`, 'an absolute path leaked into the refusal').not.toContain(elsewhere);
  });

  it('expands an unquoted heredoc body the way the shell does', () => {
    // `<<EOF` is expanded: `$(…)` and backticks in the body genuinely run. `<<\'EOF\'` and `<<"EOF"`
    // are literal. Treating every body as data meant `git commit -F- <<EOF` with a push inside a
    // substitution executed it while no guard saw it — the principle this file applies to quoted
    // strings, not applied to the one place the shell applies it too.
    const live = scratchRepo('main');
    const inert = scratchRepo('feat/probe');

    const expanded = runHook(
      'branch-guard.sh',
      ['git commit -F- <<EOF', '$(git push --force origin main)', 'EOF'].join('\n'),
      { cwd: live },
    );
    expect(expanded.status, 'a substitution in an expanded heredoc body went unseen').toBe(2);

    const literal = runHook(
      'branch-guard.sh',
      ["git commit -F- <<'EOF'", '$(git push --force origin main)', 'EOF'].join('\n'),
      { cwd: inert },
    );
    expect(literal.status, 'a quoted delimiter makes the body data; it was read as a command').toBe(
      0,
    );

    const prose = runHook(
      'branch-guard.sh',
      ['git commit -F- <<EOF', 'prose about git push here', 'EOF'].join('\n'),
      { cwd: inert },
    );
    expect(prose.status, 'prose in an expanded body is still prose').toBe(0);
  });

  it("runs only the interpreter's own argument", () => {
    // The exception ran to every quoted string later in the statement, so the positional argument in
    // `python3 -c "x=1" "…"` was scanned as code and an ordinary command was refused. A quoted
    // argument ends the run; the first string still counts.
    const cwd = scratchRepo('feat/probe');
    const positional = runHook(
      'branch-guard.sh',
      'python3 -c "x=1" "just text mentioning git push"',
      { cwd },
    );
    expect(positional.status, 'a positional argument was read as code').toBe(0);

    const real = runHook('branch-guard.sh', 'bash -x -c "git push origin main"', {
      cwd: scratchRepo('main'),
    });
    expect(real.status, "the interpreter's own string stopped being read").toBe(2);
  });

  it('does not expand what the shell would not expand', () => {
    // Two ways the substitution restore over-reached, both found by it blocking its own commit.
    //
    //   * `\\$(…)` and an escaped backtick are literal characters, not substitutions.
    //   * SINGLE quotes suppress every expansion, so nothing inside them is a command — the restore
    //     pass ignored quoting entirely and read a single-quoted payload as a subshell.
    //
    // Over-restoring is the self-blocking direction: it refuses ordinary commands, which is the
    // failure this whole change exists to end.
    const cwd = scratchRepo('feat/probe');
    const inert = [
      'git commit -m "a \\`gh pr merge\\` here"',
      'git commit -m "use \\$(cmd) with git push"',
      "echo '$(git push origin main)'",
      'printf \'{"command":"git push origin main"}\' | cat',
    ];

    for (const command of inert) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard expanded what the shell would not: ${command}`).toBe(0);
    }
  });

  it('still expands what the shell does expand', () => {
    // The limit of the rule above. A real substitution runs whatever quoting surrounds it, and
    // under-restoring is the bypass direction.
    const cwd = scratchRepo('main');

    for (const command of ['echo `git push origin main`', 'echo "$(git push origin main)"']) {
      const result = runHook('branch-guard.sh', command, { cwd });
      expect(result.status, `branch-guard missed a real substitution: ${command}`).toBe(2);
    }
  });

  it('survives an unbalanced quote inside a comment', () => {
    // Comment stripping was `sed 's/[[:space:]]#[^\"]*$//'`, which refused to match whenever a quote
    // appeared after the `#` — including inside the comment itself. The stray quote then opened a
    // string the masker never saw closed, and EVERY LINE AFTER IT was masked away: the delete on
    // the next line was invisible to all four guards.
    const cwd = scratchRepo('main');
    const command = ['echo ok # a "half-open remark', 'git push origin --delete develop'].join(
      '\n',
    );
    const result = runHook('branch-guard.sh', command, { cwd });

    expect(result.status, 'a comment with one quote in it hid the command that followed').toBe(2);
  });

  it('does not read a # inside a multi-line quoted argument as a comment', () => {
    // The comment stripper reset its quote state at each line while the masker it feeds joins them
    // — so a `#` on the continuation line of a multi-line message was read as a comment start, and
    // the rest of that line, including the real closing quote and everything chained after it, was
    // discarded. The same defect class as the bug it was fixing, through the opposite mechanism.
    const cwd = scratchRepo('feat/probe');
    const command = [
      'git commit -m "line one',
      'line two # not a comment" && git push origin --delete develop',
    ].join('\n');
    const result = runHook('branch-guard.sh', command, { cwd });

    expect(result.status, 'a delete after a multi-line message went unseen').toBe(2);
  });

  it('still ignores a verb named inside a comment', () => {
    // The other side: a `#` remark is prose, and quote-awareness must not cost that.
    const cwd = scratchRepo('feat/probe');
    const result = runHook('branch-guard.sh', 'git status # note about git push', { cwd });

    expect(result.status, 'a comment was read as a command').toBe(0);
  });

  it('leaves ordinary work alone', () => {
    const cwd = scratchRepo('feat/probe');
    for (const hook of ['branch-guard.sh', 'worktree-cwd-guard.sh', 'pre-push-check.sh']) {
      const result = runHook(hook, `cd ${cwd} && git status`, {
        cwd,
        env: { ROBOTA_AGENT_WORKTREE: '1' },
      });
      expect(result.status, `${hook} blocked an ordinary command`).toBe(0);
    }
  });
});

describe('the command parse has one owner', () => {
  /**
   * The defects above were one defect copied four times. Sharing the parser is what makes fixing it
   * once enough — so a hook growing its own decoder again is the regression to catch, not the
   * individual mis-parse it would reintroduce.
   */
  const bashHooks = readdirSync(HOOKS_DIR).filter((name) => name.endsWith('.sh'));

  it('finds hooks to check', () => {
    // Fail closed: a moved directory would make the assertions below pass over nothing.
    expect(bashHooks.length).toBeGreaterThan(0);
  });

  for (const hook of bashHooks) {
    it(`${hook} does not re-implement the command decode`, () => {
      const source = readFileSync(path.join(HOOKS_DIR, hook), 'utf8');
      const handRolled = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .some((line) => /grep\s+-o\s+'"(command|cwd|tool_name)"/.test(line));

      expect(
        handRolled,
        `${hook} decodes the hook payload with grep. That expression stops at the first quote ` +
          'inside the value. Source lib/command-scan.sh and use hook_command_of / hook_cwd_of.',
      ).toBe(false);
    });
  }

  it('truncates no command at the first heredoc opener', () => {
    for (const hook of bashHooks) {
      const source = readFileSync(path.join(HOOKS_DIR, hook), 'utf8');
      const truncatesAtHeredoc = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .some((line) => /%%<<\*/.test(line));

      expect(
        truncatesAtHeredoc,
        `${hook} discards everything from the first heredoc opener onward, so a command written ` +
          'after the terminator is never examined. Use hook_strip_heredocs.',
      ).toBe(false);
    }
  });
});
