import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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
  const dir = makeTemp('openpr-freeze-');
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
function stubGh({ prNumber, findings, author = 'github-actions[bot]', failingChecks = 0 }) {
  const dir = makeTemp('openpr-gh-');
  scratch.push(dir);

  // The payload real `gh` would have fetched, in the shape the hook's `--json comments,reviews` asks
  // for. The stub does NOT pre-compute an answer from it: it runs the hook's OWN `--jq` expression
  // over this with real jq, so the filter, the marker pattern and the `sort_by(.at)` ordering are all
  // exercised as written in the hook.
  //
  // The earlier stub echoed a body it had decided in JS, which left the jq string untested — and a
  // malformed jq is swallowed by the hook's `2>/dev/null`, yielding an empty count that reads as
  // unknown and lets the push through. That is fail-open on exactly the scenario this gate exists to
  // block, and the tests would have stayed green through it.
  const payload = {
    comments:
      findings === null
        ? []
        : [
            {
              author: { login: 'someone-else' },
              body: 'unrelated chatter',
              createdAt: '2020-01-01T00:00:00Z',
            },
            {
              author: { login: author },
              body: `REVIEWED HEAD: ${'0'.repeat(40)}\nACTIONABLE FINDINGS: ${findings}`,
              createdAt: '2020-01-02T00:00:00Z',
            },
          ],
    reviews: [],
  };
  writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(payload));

  writeFileSync(
    path.join(dir, 'gh'),
    [
      '#!/bin/bash',
      "# Run the caller's own --jq over the fixture payload, the way gh does.",
      '# The THIRD question the guard asks (issue #2338): is a required check failing? Answered',
      '# from the fixture like the others, so the guard reads a real number and not a stub decision.',
      'if [[ "$*" == *"pr checks"* ]]; then',
      `  printf '%s\\n' '${failingChecks}'`,
      '  exit 0',
      'fi',
      'if [[ "$*" == *"comments,reviews"* ]]; then',
      '  jqexpr=""',
      '  while [ $# -gt 0 ]; do',
      '    if [ "$1" = "--jq" ]; then jqexpr="$2"; fi',
      '    shift',
      '  done',
      `  jq -r "$jqexpr" ${JSON.stringify(path.join(dir, 'payload.json'))}`,
      '  exit $?',
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

function push({ findings, prNumber = 4242, author, prefix = '', failingChecks = 0 }) {
  const dir = scratchRepo();
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      cwd: dir,
      tool_input: { command: `${prefix}git push -u origin ${BRANCH}` },
    }),
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: dir,
      PATH: `${stubGh({ prNumber, findings, author, failingChecks })}${path.delimiter}${process.env.PATH}`,
    },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('pre-push open-PR freeze — RED direction', () => {
  it('refuses a push when the open PR’s latest review reports zero findings', () => {
    const res = push({ findings: 0 });
    expect(res.status).toBe(2);
    expect(res.output).toMatch(/ACTIONABLE FINDINGS: 0/);
    // What the guard OBSERVED, not a diagnosis it never established (issue #2338): the wording used
    // to assert "new work on a merge-ready PR", which was false in every measured instance.
    expect(res.output).toMatch(/no published finding and no red\s+.*check to resolve/s);
    expect(res.output).not.toMatch(/already merge-ready/);
  });

  it('names the recovery, not only the refusal', () => {
    const res = push({ findings: 0 });
    // It must name ALL THREE grounds, and say which two it read — a refusal that lists only the
    // remedy it can see trains the author to override for the one it cannot (issue #2338).
    expect(res.output).toMatch(/published\s+.*finding, a red required check, or a rebase/s);
    expect(res.output).toMatch(/let #4242 land/i);
    // The hatch is this rule's own. It used to be PRE_PUSH_ALLOW_UNREVIEWED, and that was the
    // defect: one switch disarmed two unrelated rules while its message claimed only the first.
    expect(res.output).toMatch(/PRE_PUSH_ALLOW_FROZEN_DIFF=1/);
  });

  it('the unreviewed-diff override does NOT excuse a frozen diff', () => {
    // The measured failure (#2323) needed no override at all, but the two hatches sharing one name
    // is how a session reaching for the documented one silently disarms this one too.
    const res = push({ findings: 0, prefix: 'PRE_PUSH_ALLOW_UNREVIEWED=1 ' });
    expect(res.status).toBe(2);
    expect(res.output).toMatch(/no published finding and no red/);
  });

  it('its own override does excuse it', () => {
    const res = push({ findings: 0, prefix: 'PRE_PUSH_ALLOW_FROZEN_DIFF=1 ' });
    expect(res.status).not.toBe(2);
  });

  it('says that recording a local review does not excuse it either', () => {
    // The refusal lived inside the branch that runs only when NO local review is recorded, so a
    // session obeying the record-before-push rule skipped it. The message now says so.
    const res = push({ findings: 0 });
    expect(res.output).toMatch(/Recording a local review does NOT excuse this/);
  });
});

describe('pre-push open-PR freeze — a RED REQUIRED CHECK is ground #2 (issue #2338)', () => {
  // Measured three times in one day across two sessions: the guard blocked a push that was fixing a
  // failing required check, on the claim the pull request was "already merge-ready" — while
  // merge-gate.sh would have refused that same pull request at the same instant on mergeStateStatus.
  // The remedy it offered ("let it land, then open a second PR") named something the blocked push
  // was the precondition for.
  it('allows the push when a required check is failing, even at zero findings', () => {
    const res = push({ findings: 0, failingChecks: 1 });
    expect(res.status).toBe(0);
  });

  it('still refuses at zero findings when NO check is failing', () => {
    // The control for the case above. Without it, a guard that never blocks would pass it.
    const res = push({ findings: 0, failingChecks: 0 });
    expect(res.status).toBe(2);
  });

  it('does not treat an unreadable check answer as zero failures', () => {
    // Unknown is not zero, the same way the findings count is not. A failed read must leave the
    // refusal standing rather than manufacture a permission out of a broken query.
    const res = push({ findings: 0, failingChecks: 'not-a-number' });
    expect(res.status).toBe(2);
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

  it('does not let a non-reviewer spoof a blocking count', () => {
    // The pair that proves the author filter. The SAME `0` blocks when the reviewer says it (the RED
    // case above) and does not when anyone else does — because a non-reviewer's marker is filtered
    // out, the count becomes unknown, and unknown is not zero. Without the filter this push would be
    // refused on a stranger's say-so, and the mirror spoof (a fake non-zero count) would unfreeze a
    // clean pull request. A gate whose input its own subject can write is not a gate.
    const res = push({ findings: 0, author: 'some-contributor' });
    expect(res.status).toBe(0);
    expect(res.output).toMatch(/its review automation owns the review/);
  });
});
