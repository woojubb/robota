/**
 * `finding-depth.md` says an open GitHub issue outranks unfiled backlog work. Nothing showed those
 * issues to anyone, so four sat open while unrelated work was picked — the filing was the end of the
 * story rather than the start of it.
 *
 * These cases are about the three ways review found the first version of that notice getting it
 * wrong, and each is a property the notice has to keep to be worth having.
 */

import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/task-tracking.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/**
 * A stand-in `gh` that HONOURS `--limit`, the way the real one does.
 *
 * A stub that ignores it cannot express the question these cases ask. Measured: with a fixed 20-line
 * stub, narrowing the hook's `--limit` changed nothing, so the case "passed" against a hook that had
 * lost the very property it was written for — a green for the wrong reason.
 */
function ghListing(total) {
  return `#!/bin/sh
limit=20
while [ $# -gt 0 ]; do
  if [ "$1" = "--limit" ]; then limit=$2; fi
  shift
done
i=1
while [ $i -le ${total} ] && [ $i -le "$limit" ]; do
  echo "  - #$i issue $i"
  i=$((i + 1))
done
`;
}

/** Run the hook with a stand-in `gh` at the front of PATH. */
function runHook(mode, { ghScript, projectDir, deadlineSeconds, env: extraEnv, emptyPath } = {}) {
  const env = { ...process.env, ...extraEnv };
  // A PATH with no `gh` on it — the "not installed" case, which `bounded_gh` reports with the same
  // exit code as "ran and failed".
  //
  // Built by SYMLINKING the binaries the hook needs into a scratch dir, and nothing else. Two
  // simpler versions were measured and both failed:
  //
  //   PATH=''                       the hook cannot run `grep` or `jq` either, produces NO output,
  //                                 and the case asserts against '' — a pass for the wrong reason
  //   PATH minus gh's directories   works here, where gh is in ~/.local/bin; on the CI runner gh
  //                                 shares a directory with coreutils, so removing it is the case
  //                                 above. RAN, and that is how this version came to exist.
  //
  // The list is what the hook and `lib/*.sh` actually invoke, read from their source. A binary
  // added there and not here makes this case fail loudly rather than silently.
  if (emptyPath === true) {
    const dir = mkdtempSync(path.join(tmpdir(), 'no-gh-path-'));
    scratch.push(dir);
    // The shells first — the hook is spawned as `bash <hook>` and its stubs are `#!/bin/sh`, so a
    // list without them means the case measures "bash not found" and calls it "gh not found".
    // Measured: that is exactly what the first list did.
    const needed = [
      'bash',
      'sh',
      'env',
      'awk',
      'basename',
      'cat',
      'cut',
      'date',
      'dirname',
      'find',
      'grep',
      'head',
      'jq',
      'kill',
      'ls',
      'mkdir',
      'mktemp',
      'node',
      'printf',
      'rm',
      'sed',
      'sleep',
      'sort',
      'tr',
      'wc',
    ];
    const searchPath = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const name of needed) {
      const found = searchPath.map((d) => path.join(d, name)).find((f) => existsSync(f));
      if (found !== undefined) symlinkSync(found, path.join(dir, name));
    }
    env.PATH = dir;
  }
  // The deadline belongs to `bounded-gh.sh` and defaults to 10s. A case about the deadline sets it
  // rather than waiting it out — otherwise the suite's own timeout fires first and the case reports
  // on the harness instead of on the hook.
  if (deadlineSeconds !== undefined) env.HOOK_GH_DEADLINE_SECONDS = String(deadlineSeconds);
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  if (ghScript !== undefined) {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-stub-'));
    scratch.push(dir);
    const gh = path.join(dir, 'gh');
    writeFileSync(gh, ghScript);
    chmodSync(gh, 0o755);
    env.PATH = `${dir}${path.delimiter}${env.PATH}`;
  }
  const result = spawnSync('bash', [HOOK, mode], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const LISTS_TWO = `#!/bin/sh
printf '  - #101 first\\n  - #102 second\\n'
`;

describe('open issues are shown where the choice is made', () => {
  it('reports them at session START', () => {
    const { output } = runHook('start', { ghScript: LISTS_TWO });

    expect(output).toMatch(/OPEN GitHub issues/);
    expect(output).toMatch(/#101 first/);
  });

  it('does NOT call GitHub on session stop', () => {
    // The first version sat above the MODE branch, so the Stop hook hit the API on every session end
    // too — while the comment beside it said "reported at session start". A comment describing
    // something the code does not do is the class this repository keeps paying for.
    const { output } = runHook('stop', {
      ghScript: `#!/bin/sh\nprintf 'THE HOOK CALLED GH\\n'\n`,
    });

    expect(output).not.toMatch(/THE HOOK CALLED GH/);
    expect(output).not.toMatch(/OPEN GitHub issues/);
  });

  it('survives an unresponsive API, and says it could not ask', () => {
    // Every other check in this file is a local grep; this is the one network call. Measured with a
    // hanging `gh`: under `set -e` the failing substitution KILLED the script, the whole session
    // notice vanished, and the hook exited 0 as if it had nothing to say. Silence on an error is the
    // one thing a hook may not do.
    const { status, output } = runHook('start', {
      ghScript: `#!/bin/sh\nsleep 30\n`,
      deadlineSeconds: 1,
    });

    expect(status).toBe(0);
    expect(output).toMatch(/deadline expired/);
    expect(output, "a timeout must not read as 'none open'").toMatch(/not asked/);
    // And the deadline it names is the one this case SET. Review measured that the hook overwrote
    // `HOOK_GH_DEADLINE_SECONDS` unconditionally, so this case ran against the 4s default while
    // claiming to test a 1s one — it passed, for the wrong reason, and the runtime (5.2s, not 2.0s)
    // was the only visible trace. Asserting the number turns that into a failure instead of a
    // slower green.
    expect(output, 'the deadline this case set was discarded').toMatch(/\(1s\)/);
  });

  it('reports a gh that FAILED, rather than passing over it', () => {
    // The likeliest failure is not a timeout — it is an unauthenticated gh, and the first version
    // passed over it in silence. "Could not ask" and "none open" are different answers, which is the
    // whole reason this notice exists.
    const { output } = runHook('start', {
      ghScript: `#!/bin/sh\necho 'not authenticated' >&2\nexit 1\n`,
    });

    expect(output).toMatch(/Could not list open GitHub issues/);
    expect(output).toMatch(/not asked/);
  });

  it('reports issues even where there is no task directory', () => {
    // The block sat below the `.agents/tasks/` existence check, so a clone reusing this hook without
    // local task tracking got no issue notice at all. Whether task FILES exist has nothing to do
    // with whether issues are open.
    const empty = mkdtempSync(path.join(tmpdir(), 'no-tasks-'));
    scratch.push(empty);

    const { output } = runHook('start', { ghScript: LISTS_TWO, projectDir: empty });

    expect(output).toMatch(/OPEN GitHub issues/);
  });

  it('says so when the list is truncated', () => {
    // A bounded list that does not say it is bounded reads as "that is all of them".
    // 25 open, and the stub honours `--limit`: the hook asks for one more than it shows, sees the
    // extra, and says so.
    const { output } = runHook('start', { ghScript: ghListing(25) });

    expect(output).toMatch(/showing the first 20/);
  });

  it('can be declined, and then makes no network call at all', () => {
    // Review: this is the only network call in a hook that was otherwise entirely local and
    // instant, and offline or unauthenticated users paid for it on every session start with no way
    // to say no. A notice is worth having; a notice you cannot turn off is a tax.
    const { output } = runHook('start', {
      ghScript: `#!/bin/sh\nprintf 'THE HOOK CALLED GH\\n'\n`,
      env: { TASK_TRACKING_SKIP_ISSUES: '1' },
    });

    expect(output).not.toMatch(/THE HOOK CALLED GH/);
    expect(output).not.toMatch(/OPEN GitHub issues/);
    // And it says nothing about the issues either way — saying nothing IS what was asked for.
    expect(output).not.toMatch(/not asked/);
  });

  it('tells a MISSING gh apart from one that ran and failed', () => {
    // `bounded_gh` returns 1 for both, and the message for the second ("often not authenticated")
    // misleads someone who simply has no `gh`. The two need different actions, so they get
    // different messages. PATH has the gh-holding directories removed rather than being emptied —
    // see the helper for why an empty PATH made this case pass for the wrong reason.
    const { output } = runHook('start', { emptyPath: true });

    expect(output).toMatch(/no `gh` on PATH/);
    expect(output).toMatch(/not asked/);
    expect(output).not.toMatch(/authenticated/);
  });

  it('does NOT claim more when exactly the shown number are open', () => {
    // The reason the hook asks for one more than it shows. A check for "hit the cap" says "there may
    // be more" when there are exactly twenty and no more, and a notice that cries wolf is one people
    // stop reading — which costs more than the truncation it was guarding.
    const { output } = runHook('start', { ghScript: ghListing(20) });

    expect(output).toMatch(/OPEN GitHub issues/);
    expect(output).not.toMatch(/there are more/);
  });
});
