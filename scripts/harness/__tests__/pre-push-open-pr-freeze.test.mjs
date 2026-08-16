import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * An open PR's diff is frozen except to resolve a finding (git-branch.md).
 *
 * The hook's open-PR exemption rests on a premise: that a push into an open pull request RESOLVES
 * what its review reported. A review reporting zero findings leaves nothing to resolve, which makes
 * the push new work landing on a pull request that is already merge-ready — reviewed by someone who
 * never saw it. `merge-gate.sh` refuses a merge whose review names a stale head, but a merge that
 * lands BEFORE the push has nothing to refuse.
 *
 * Each case runs the REAL hook against a SCRATCH repository with a stubbed `gh`, never the
 * workspace: pointing it at the live tree made the verdict depend on whether that branch happened to
 * have a review recorded, which is the environment answering instead of the case.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/pre-push-check.sh');
const BRANCH = 'feat/probe';
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A repository with one commit, a lockfile, and no recorded local review. */
function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpr-freeze-'));
  scratch.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${BRANCH}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

/**
 * A `gh` answering the two questions this branch of the hook asks, in the shape real `gh` prints
 * AFTER applying the `--jq` the hook passes: a bare pull-request number, and the body of the latest
 * comment carrying the verdict marker. A stub answering its own preferred shape would keep passing
 * while the hook stopped working.
 */
function stubGh({ prNumber, findings }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'openpr-gh-'));
  scratch.push(dir);
  const body = findings === null ? '' : `ACTIONABLE FINDINGS: ${findings}`;
  writeFileSync(
    path.join(dir, 'gh'),
    [
      '#!/bin/bash',
      'if [[ "$*" == *"comments,reviews"* ]]; then',
      `  printf '%s\\n' ${JSON.stringify(body)}`,
      '  exit 0',
      'fi',
      'for arg in "$@"; do',
      `  if [ "$arg" = "--head" ]; then printf '%s\\n' '${prNumber}'; exit 0; fi`,
      'done',
      'printf "OPEN\\n"',
    ].join('\n'),
    { mode: 0o755 },
  );
  return dir;
}

function push({ findings, prNumber = 4242 }) {
  const dir = scratchRepo();
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      cwd: dir,
      tool_input: { command: `git push -u origin ${BRANCH}` },
    }),
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: dir,
      PATH: `${stubGh({ prNumber, findings })}${path.delimiter}${process.env.PATH}`,
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('pre-push open-PR freeze — RED direction', () => {
  it('refuses a push when the open PR’s latest review reports zero findings', () => {
    const res = push({ findings: 0 });
    expect(res.status).toBe(2);
    expect(res.output).toMatch(/ACTIONABLE FINDINGS: 0/);
    expect(res.output).toMatch(/nothing for this push to resolve/);
  });

  it('names the recovery, not only the refusal', () => {
    const res = push({ findings: 0 });
    expect(res.output).toMatch(/open a second PR/i);
    expect(res.output).toMatch(/PRE_PUSH_ALLOW_UNREVIEWED=1/);
  });
});

describe('pre-push open-PR freeze — GREEN direction', () => {
  it('allows the push when findings remain, since that push is the resolution', () => {
    const res = push({ findings: 2 });
    expect(res.status).toBe(0);
    expect(res.output).toMatch(/its review automation owns the review/);
  });

  it('allows the push when the count cannot be read — unknown is not zero', () => {
    const res = push({ findings: null });
    expect(res.status).toBe(0);
    expect(res.output).toMatch(/its review automation owns the review/);
  });

  it('does not read a stale COUNT answer as a pull-request number', () => {
    // The lookup once asked for a count; anything still answering that prints `0` for "none open",
    // which read as a number would be pull request #0 — handing the exemption to a branch with none.
    const res = push({ findings: 0, prNumber: 0 });
    expect(res.status).toBe(2);
    expect(res.output).not.toMatch(/nothing for this push to resolve/);
  });
});
