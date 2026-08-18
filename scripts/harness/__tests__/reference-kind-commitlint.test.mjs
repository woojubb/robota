/**
 * INFRA-106 — the reference-kind rule is REACHED by the command commits actually pass through.
 *
 * `scan-reference-kind-qualified.test.mjs` proves the judgement. This proves the wiring: a rule that
 * is correct and unreachable from the configuration is a green nobody earned, and this repository
 * has a whole scan family (`wiring-verification`) about exactly that gap.
 *
 * It also pins the coexistence. Registering the two custom rules as two plugin ENTRIES made
 * commitlint load only the last one and then refuse the whole config with `Found rules without
 * implementation: claims-resolve` — a failure that could only appear once a second custom rule
 * existed, which is to say on this change and never before it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// allow-missing-artifact-file: the one path this file names deliberately does not exist — the case asserts that a citation resolving to nothing is refused, so a path that resolved would prove the opposite

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

describe('a bare #N does not reach a commit', () => {
  it('refuses a message carrying one', () => {
    const result = runCommitlint('fix(x): probe\n\nsee #1884 for the report\n');
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toMatch(/reference-kind/);
    expect(result.output).toMatch(/#1884/);
  });

  it('accepts the qualified forms and the exempt ones together', () => {
    // One message carrying every shape the rule permits, so a regression in any single exemption
    // shows up here rather than only in the unit cases.
    const result = runCommitlint(
      'fix(x): probe\n\nLanded as PR #1886, which came from issue #1884 and pull request #1880.\n' +
        'The literal `#1` is a specimen.\n\nCloses #1884\n',
    );
    expect(result.output).not.toMatch(/reference-kind/);
  });
});

describe('the other custom rule still loads beside it', () => {
  it('claims-resolve still refuses a citation that resolves to nothing', () => {
    const result = runCommitlint(
      'fix(x): probe\n\nedits `scripts/harness/definitely-not-here.mjs`\n',
    );
    expect(result.output).toMatch(/claims-resolve/);
  });

  it('and still leaves an ordinary message alone', () => {
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    }).trim();
    const result = runCommitlint(
      `fix(x): ordinary\n\nEdits \`scripts/harness/run-all-scans.mjs\`, after ${head}.\n`,
    );
    expect(result.status, result.output).toBe(0);
  });
});
