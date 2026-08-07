/**
 * `finding-depth.md` says an open GitHub issue outranks unfiled backlog work. Nothing showed those
 * issues to anyone, so four sat open while unrelated work was picked — the filing was the end of the
 * story rather than the start of it.
 *
 * These cases are about the three ways review found the first version of that notice getting it
 * wrong, and each is a property the notice has to keep to be worth having.
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
function runHook(mode, { ghScript, projectDir } = {}) {
  const env = { ...process.env };
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
    const { status, output } = runHook('start', { ghScript: `#!/bin/sh\nsleep 30\n` });

    expect(status).toBe(0);
    expect(output).toMatch(/did not answer within/);
    expect(output, "a timeout must not read as 'none open'").toMatch(/not asked/);
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

  it('does NOT claim more when exactly the shown number are open', () => {
    // The reason the hook asks for one more than it shows. A check for "hit the cap" says "there may
    // be more" when there are exactly twenty and no more, and a notice that cries wolf is one people
    // stop reading — which costs more than the truncation it was guarding.
    const { output } = runHook('start', { ghScript: ghListing(20) });

    expect(output).toMatch(/OPEN GitHub issues/);
    expect(output).not.toMatch(/there are more/);
  });
});
