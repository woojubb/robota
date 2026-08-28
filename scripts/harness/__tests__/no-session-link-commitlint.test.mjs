/**
 * RULE-016 (issue #2403) — a commit message carries no agent-session link, and the rule that says so
 * is REACHED by the command commits actually pass through.
 *
 * `reference-kind-commitlint.test.mjs` established the shape: spawn the real `commitlint` with the
 * real config, because a rule that is correct and unreachable from the configuration is a green
 * nobody earned — and because a second custom rule registered as a second plugin ENTRY made
 * commitlint load only the last one (the coexistence lesson recorded in `commitlint.config.js`).
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

function runCommitlint(message) {
  const result = spawnSync('npx', ['commitlint'], {
    cwd: WORKSPACE_ROOT,
    input: message,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('an agent-session link does not reach a commit', () => {
  it('refuses a `Claude-Session:` trailer', () => {
    const result = runCommitlint(
      'fix(x): probe\n\nbody\n\nCo-Authored-By: Someone <someone@example.com>\n' +
        'Claude-Session: https://claude.ai/code/session_017aiCyNj8HsA9DJBkaeoqot\n',
    );
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/no-session-link/);
    expect(result.output).toMatch(/Claude-Session/);
  });

  it('refuses a session URL anywhere in the body, trailer or not', () => {
    const result = runCommitlint(
      'fix(x): probe\n\nsee https://claude.ai/code/session_017aiCyNj8HsA9DJBkaeoqot for the transcript\n',
    );
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/no-session-link/);
  });

  it('leaves `Co-Authored-By` and an ordinary message alone', () => {
    const result = runCommitlint(
      'fix(x): ordinary\n\nA plain body.\n\nCo-Authored-By: Someone <someone@example.com>\n',
    );
    expect(result.output).not.toMatch(/no-session-link/);
    expect(result.status, result.output).toBe(0);
  });
});

describe('the other custom rules still load beside it', () => {
  it('reference-kind still refuses a bare #N', () => {
    const result = runCommitlint('fix(x): probe\n\nsee #1884 for the report\n');
    expect(result.output).toMatch(/reference-kind/);
  });
});
