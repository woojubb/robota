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

/** Run the hook with a stand-in `gh` at the front of PATH. */
function runHook(mode, { ghScript } = {}) {
  const env = { ...process.env };
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

  it('says so when the list is truncated', () => {
    // A bounded list that does not say it is bounded reads as "that is all of them".
    const twentyFive = Array.from({ length: 25 }, (_, i) => `  - #${i + 1} issue ${i + 1}`).join(
      '\\n',
    );
    const { output } = runHook('start', { ghScript: `#!/bin/sh\nprintf '${twentyFive}\\n'\n` });

    expect(output).toMatch(/showing the first 20/);
  });
});
