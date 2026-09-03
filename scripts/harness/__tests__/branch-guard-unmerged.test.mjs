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
 * PROC-012 (issue #2135) then found the same question asked with the wrong DATA. The check pulled
 * one global `pr list --state merged --limit 500` and matched candidates against it. That list is
 * saturated in this repository, so every merged PR older than the window fell out and its branch was
 * reported unmerged again — with a NOTE saying the list came back full, printed by a guard that then
 * blocked anyway. Measured 2026-08-23: it blocked branch creation in two of four active clones inside
 * ten minutes, on branches merged as #2143, #2147, #2133 and #2144.
 *
 * So the query is now per-branch (`--head`, which has no window to saturate) and the decision needs
 * three things: a merged PR for the name, the branch still at the commit that PR merged, and that
 * PR's MERGE COMMIT present on the integration ref. The assertions below are about that DECISION,
 * and `gh` is stubbed to state the world.
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

function sha(dir, rev) {
  return spawnSync('git', ['-C', dir, 'rev-parse', rev], { encoding: 'utf8' }).stdout.trim();
}

/** Advance develop by one commit, so it has a commit a branch's "merge" can point at. */
function squashOnto(dir, label) {
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('checkout', '--quiet', 'develop');
  writeFileSync(path.join(dir, `squashed-${label}`), 'm\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', `feat: squashed ${label}`);
  return sha(dir, 'develop');
}

/**
 * A PATH whose `gh` answers the per-branch merged-PR query.
 *
 * `merges` maps a branch name to `"<headRefOid> <mergeCommitOid>"` — exactly the two fields the
 * decision needs. A branch absent from the map has no merged PR. Any query the hook makes other than
 * `--state merged` exits non-zero, so a change in what the hook ASKS FOR shows up as an unread answer
 * rather than a silently different verdict.
 *
 * A branch with no merged PR answers `null null` (issue #2173). That is what the real command
 * prints: `--jq '.[0] | "\(.headRefOid) \(.mergeCommit.oid)"'` on an empty list interpolates two
 * `null`s. This stub used to print NOTHING for that case — a world `gh` never produces — and both
 * spellings happened to reach the same verdict only because the comparison of the day did not tell
 * them apart. The hook now guards `merged_commit != "null"`, which is exactly the branch an empty
 * stub could never reach. `emptyNoMerge` keeps the empty spelling as one explicit case rather than
 * the default.
 */
function stubbedPath(merges, { broken = false, hangs = false, emptyNoMerge = false } = {}) {
  const dir = makeTemp('gh-stub-');
  scratch.push(dir);
  const gh = path.join(dir, 'gh');
  const cases = Object.entries(merges).map(
    ([branch, line]) =>
      `  *"--state merged"*"--head ${branch}"*) echo ${JSON.stringify(line)}; exit 0 ;;`,
  );
  writeFileSync(
    gh,
    [
      '#!/bin/sh',
      broken ? 'exit 1' : '',
      hangs ? 'sleep 120' : '',
      'case "$*" in',
      ...cases,
      // A branch with no merged PR: gh + jq print the literal `null null` and exit 0.
      emptyNoMerge
        ? '  *"--state merged"*) exit 0 ;;'
        : '  *"--state merged"*) echo "null null"; exit 0 ;;',
      'esac',
      'exit 1',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  chmodSync(gh, 0o755);
  return `${dir}:${process.env.PATH}`;
}

function judge(cwd, merges, options) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      cwd,
      tool_input: { command: 'git checkout -b feat/next' },
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: stubbedPath(merges, options),
      CLAUDE_PROJECT_DIR: cwd,
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('branch-guard counts only branches that are really still open', () => {
  it('allows a new branch when every open-looking branch landed on the integration ref', () => {
    const cwd = scratchRepo(['feat/a', 'feat/b']);
    const headA = sha(cwd, 'feat/a');
    const headB = sha(cwd, 'feat/b');
    const mergeA = squashOnto(cwd, 'a');
    const mergeB = squashOnto(cwd, 'b');

    const verdict = judge(cwd, {
      'feat/a': `${headA} ${mergeA}`,
      'feat/b': `${headB} ${mergeB}`,
    });

    expect(
      verdict.status,
      'squash-merged branches were counted as unmerged, which is the 88%-false-positive shape that ' +
        'made this check something to override rather than something to obey.',
    ).toBe(0);
  });

  it('still refuses while a branch has no merged PR', () => {
    // The rule itself is unchanged: real unmerged work still blocks a new branch.
    const cwd = scratchRepo(['feat/a', 'feat/open']);
    const headA = sha(cwd, 'feat/a');
    const mergeA = squashOnto(cwd, 'a');

    const verdict = judge(cwd, { 'feat/a': `${headA} ${mergeA}` });

    expect(verdict.status, 'genuinely unmerged work stopped blocking').toBe(2);
    expect(verdict.output).toMatch(/feat\/open/);
    expect(verdict.output, 'a merged branch was named as unmerged').not.toMatch(/- feat\/a /);
  });

  it("treats gh's `null null` for a branch with no merged PR as unmerged (issue #2173)", () => {
    // Spelled explicitly, not via the stub default: the literal `null null` is the answer the real
    // `gh … --jq` gives for an empty list, and it must never be read as a merged head or a merge
    // commit. Were the hook to compare only `-n "$merged_commit"`, this would go green — the string
    // `null` is non-empty.
    const cwd = scratchRepo(['feat/open']);
    const verdict = judge(cwd, { 'feat/open': 'null null' });

    expect(verdict.status, '`null null` was accepted as a merged PR').toBe(2);
    expect(verdict.output).toMatch(/feat\/open/);
    expect(verdict.output, 'a `null null` answer was reported as a query failure').not.toMatch(
      /merged-PR query failed/,
    );
  });

  it('still refuses on genuinely EMPTY output, which is the other spelling of "no merged PR"', () => {
    // Kept as one explicit case: empty output is not what gh prints for an empty list, but a jq
    // change (`// empty`, `-e`) could produce it, and the verdict must be the same.
    const cwd = scratchRepo(['feat/open']);
    const verdict = judge(cwd, {}, { emptyNoMerge: true });

    expect(verdict.status, 'empty output was accepted as a merged PR').toBe(2);
    expect(verdict.output).toMatch(/feat\/open/);
  });

  it('refuses a branch whose PR merged somewhere other than the integration ref', () => {
    // PROC-012's second half, and the reason "was it merged" is not the whole question. Measured
    // 2026-08-23 on `origin`: four branches carried a merged PR whose base was a FEATURE branch that
    // has since been deleted, so their work is on neither develop nor main. A check that stops at
    // "a merged PR exists" clears all four and the work is gone.
    const cwd = scratchRepo(['feat/a', 'feat/elsewhere']);
    const headA = sha(cwd, 'feat/a');
    const mergeA = squashOnto(cwd, 'a');
    // Merged, but onto a branch that is not develop — so its merge commit is not reachable from it.
    const headElsewhere = sha(cwd, 'feat/elsewhere');

    const verdict = judge(cwd, {
      'feat/a': `${headA} ${mergeA}`,
      'feat/elsewhere': `${headElsewhere} ${headElsewhere}`,
    });

    expect(
      verdict.status,
      'a branch merged into a third branch was cleared as if it had landed on the integration ref',
    ).toBe(2);
    expect(verdict.output).toMatch(/feat\/elsewhere/);
  });

  it('does not accept a merged name carrying new commits', () => {
    // A branch name gets reused: merge `feat/a`, leave the local branch, stack new work on it. Matching
    // the NAME alone waves those commits through and disables the rule this check enforces. The
    // delete-guard in the same file already carries that lesson; this path was written without it.
    const cwd = scratchRepo(['feat/a']);
    const headA = sha(cwd, 'feat/a');
    const mergeA = squashOnto(cwd, 'a');

    const git = (...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    git('checkout', '--quiet', 'feat/a');
    writeFileSync(path.join(cwd, 'after-merge'), 'z\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'feat: work stacked after the merge');
    git('checkout', '--quiet', 'develop');

    const verdict = judge(cwd, { 'feat/a': `${headA} ${mergeA}` });

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
    const headA = sha(cwd, 'feat/a');
    const mergeA = squashOnto(cwd, 'a');
    const started = Date.now();
    const verdict = judge(cwd, { 'feat/a': `${headA} ${mergeA}` });
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
    const verdict = judge(cwd, {}, { hangs: true });
    const elapsed = Date.now() - started;

    expect(elapsed, 'the hook waited on a stalled query instead of falling back').toBeLessThan(
      40_000,
    );
    expect(verdict.status).toBe(2);
    expect(verdict.output, 'the fallback did not explain why the list is inflated').toMatch(
      /merged-PR query failed/,
    );
  });

  it('says so when the merged-PR query could not be read', () => {
    // Without gh the check falls back to ancestry, which over-reports. That is the safe direction,
    // but a list that is longer than the real backlog must say why — an unexplained wall of names
    // is what gets overridden. It must also name the by-hand check, because the next thing a reader
    // does with an unexplained block is reach for the override.
    const cwd = scratchRepo(['feat/a']);
    const verdict = judge(cwd, {}, { broken: true });

    expect(verdict.status).toBe(2);
    expect(verdict.output, 'the fallback did not explain that the list is inflated').toMatch(
      /merged-PR query failed/,
    );
    expect(verdict.output, 'the fallback did not name the by-hand verification').toMatch(
      /--state merged --head/,
    );
  });
});
