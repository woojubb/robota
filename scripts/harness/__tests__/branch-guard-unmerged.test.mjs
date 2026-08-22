import { spawnSync } from 'node:child_process';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/branch-guard.sh');

/**
 * The one-branch-at-a-time rule, judged by whether a branch is ACTUALLY still open.
 *
 * A squash-merged PR leaves commits that git cannot find in the integration branch, so ancestry
 * alone calls such a branch unmerged forever. Measured on 2026-07-28 in this repository: 83 local
 * branches reported as unmerged, 73 of them with a MERGED PR — an 88% false-positive rate. A guard
 * that is wrong seven times out of eight is overridden as a reflex, and it was, twice in one
 * session. The check's own failure message already told people to delete squash-merged branches;
 * it simply never used what the message knew.
 *
 * So the assertions below are about the DECISION, and `gh` is stubbed to state the world.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(branches) {
  const dir = makeTemp('branch-guard-');
  scratch.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=develop');
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'root'), 'x\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');

  // Each extra branch carries a commit develop does not have — the shape a squash merge leaves.
  for (const name of branches) {
    git('checkout', '--quiet', '-b', name);
    writeFileSync(path.join(dir, name.replace(/\//g, '-')), 'y\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', `feat: ${name}`);
    git('checkout', '--quiet', 'develop');
  }
  return dir;
}

/**
 * A PATH whose `gh` reports exactly the merged head refs given.
 *
 * `--state merged` is the only query the hook makes here; anything else exits non-zero so a change
 * in what the hook asks for shows up as an unread answer rather than a silently different verdict.
 */
function stubbedPath(mergedRefs, { broken = false, hangs = false } = {}) {
  const dir = makeTemp('gh-stub-');
  scratch.push(dir);
  const gh = path.join(dir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/bin/sh',
      broken ? 'exit 1' : '',
      hangs ? 'sleep 120' : '',
      'case "$*" in',
      '  *"--state merged"*)',
      mergedRefs.map((r) => `    echo ${JSON.stringify(r)}`).join('\n'),
      '    exit 0 ;;',
      'esac',
      'exit 1',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  chmodSync(gh, 0o755);
  return `${dir}:${process.env.PATH}`;
}

/** The line gh returns for a merged PR: the branch name and the commit that was merged. */
function mergedRef(dir, branch) {
  const oid = spawnSync('git', ['-C', dir, 'rev-parse', branch], {
    encoding: 'utf8',
  }).stdout.trim();
  return `${branch} ${oid}`;
}

function judge(cwd, mergedRefs, options) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      cwd,
      tool_input: { command: 'git checkout -b feat/next' },
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stubbedPath(mergedRefs, options),
      CLAUDE_PROJECT_DIR: cwd,
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('branch-guard counts only branches that are really still open', () => {
  it('allows a new branch when every open-looking branch has a merged PR', () => {
    const cwd = scratchRepo(['feat/a', 'feat/b']);
    const verdict = judge(cwd, [mergedRef(cwd, 'feat/a'), mergedRef(cwd, 'feat/b')]);

    expect(
      verdict.status,
      'squash-merged branches were counted as unmerged, which is the 88%-false-positive shape that ' +
        'made this check something to override rather than something to obey.',
    ).toBe(0);
  });

  it('still refuses while a branch has no merged PR', () => {
    // The rule itself is unchanged: real unmerged work still blocks a new branch.
    const cwd = scratchRepo(['feat/a', 'feat/open']);
    const verdict = judge(cwd, [mergedRef(cwd, 'feat/a')]);

    expect(verdict.status, 'genuinely unmerged work stopped blocking').toBe(2);
    expect(verdict.output).toMatch(/feat\/open/);
    expect(verdict.output, 'a merged branch was named as unmerged').not.toMatch(/- feat\/a /);
  });

  it('does not accept a merged name carrying new commits', () => {
    // A branch name gets reused: merge `feat/a`, leave the local branch, stack new work on it. Matching
    // the NAME alone waves those commits through and disables the rule this check enforces. The
    // delete-guard in the same file already carries that lesson; this path was written without it.
    const cwd = scratchRepo(['feat/a']);
    const mergedAt = mergedRef(cwd, 'feat/a');

    const git = (...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    git('checkout', '--quiet', 'feat/a');
    writeFileSync(path.join(cwd, 'after-merge'), 'z\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'feat: work stacked after the merge');
    git('checkout', '--quiet', 'develop');

    const verdict = judge(cwd, [mergedAt]);

    expect(verdict.status, 'new commits on a merged branch name were counted as merged').toBe(2);
    expect(verdict.output).toMatch(/feat\/a/);
  });

  it('returns as soon as the query answers', () => {
    // The deadline must bound the SLOW case without taxing the fast one. Two ways that was got
    // wrong here, both found by measuring rather than reading: a `kill -0` polling loop paid a
    // second of granularity on every success, and the watchdog that replaced it inherited the
    // command substitution's pipe — which does not close until every process holding it is gone —
    // so a successful query still waited the full ten seconds, worse than what it replaced.
    const cwd = scratchRepo(['feat/a']);
    const started = Date.now();
    const verdict = judge(cwd, [mergedRef(cwd, 'feat/a')]);
    const elapsed = Date.now() - started;

    expect(verdict.status, verdict.output).toBe(0);
    expect(
      elapsed,
      'a successful query paid the deadline anyway, so every branch creation costs it',
    ).toBeLessThan(5_000);
  });

  it('does not hang when the merged-PR query stalls', { timeout: 60_000 }, () => {
    // This path was entirely local before the check made a network call, and it runs on every branch
    // creation. A SLOW response is not a failed one: without a bound, a stalled connection hangs the
    // hook indefinitely rather than taking the fallback written for exactly this case.
    const cwd = scratchRepo(['feat/a']);
    const started = Date.now();
    const verdict = judge(cwd, [], { hangs: true });
    const elapsed = Date.now() - started;

    expect(elapsed, 'the hook waited on a stalled query instead of falling back').toBeLessThan(
      40_000,
    );
    expect(verdict.status).toBe(2);
    expect(verdict.output, 'the fallback did not explain why the list is inflated').toMatch(
      /merged PRs could not be read/,
    );
  });

  it('says so when merged PRs could not be read', () => {
    // Without gh the check falls back to ancestry, which over-reports. That is the safe direction,
    // but a list that is longer than the real backlog must say why — an unexplained wall of names
    // is what gets overridden.
    const cwd = scratchRepo(['feat/a']);
    const verdict = judge(cwd, [], { broken: true });

    expect(verdict.status).toBe(2);
    expect(verdict.output, 'the fallback did not explain that the list is inflated').toMatch(
      /merged PRs could not be read/,
    );
  });
});
