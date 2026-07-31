import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/merge-gate.sh');

/**
 * The gate's DECISION, not merely that it reacted.
 *
 * The sibling reachability test asks whether the hook fires at all, and the parsing test asks
 * whether it reads the right command. Neither touches what it then decides — so a gate that
 * looked for a reviewer login nobody uses, and therefore refused every merge forever, would pass
 * both and teach everyone to pass `MERGE_GATE_ACK=1`. That is the bypass this hook exists to stop,
 * installed by the hook itself. Review named the shape; this file is the answer to it.
 *
 * `gh` is stubbed, so each case states the world and the assertion is the verdict.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A PATH whose `gh` answers from a fixture.
 *
 * The stub dispatches on the flags the hook actually passes, so a change in what the hook asks for
 * shows up here as an empty answer rather than as a silently different verdict.
 */
function stubbedPath({ state, comments = [], headAt, labels = [] }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-gate-'));
  scratch.push(dir);

  const fixture = path.join(dir, 'fixture.json');
  writeFileSync(fixture, JSON.stringify({ state, comments, headAt, labels }));

  const gh = path.join(dir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      `const f = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));`,
      'const args = process.argv.slice(2).join(" ");',
      '// PROC-007: the gate now asks the PR for its finding-depth disposition before anything',
      '// else, and an unreadable label set is a refusal. These cases are about CI and the review,',
      '// so they answer the sentinel-wrapped empty set — "this PR carries no disposition" — rather',
      '// than leaving the query unanswered, which would block every one of them for the wrong',
      '// reason. The disposition itself is judged in merge-gate-disposition.test.mjs.',
      'if (args.includes("--json labels")) {',
      '  const jq = process.argv[process.argv.indexOf("--jq") + 1] ?? "";',
      '  const names = f.labels ?? [];',
      '  console.log(jq.includes("\\"|\\"") ? `|${names.join("|")}|` : names.join(","));',
      '  process.exit(0);',
      '}',
      'if (args.includes("mergeStateStatus")) { console.log(f.state); process.exit(0); }',
      'if (args.includes("--json commits")) { console.log(f.headAt ?? ""); process.exit(0); }',
      'if (args.includes("--json comments")) {',
      '  const jq = process.argv[process.argv.indexOf("--jq") + 1] ?? "";',
      '  // Apply the pattern the HOOK passed, never one written here. Filtering by a copy of the',
      '  // expected login made every case pass no matter what the hook looked for — the wrong',
      '  // reviewer name, the exact defect under test, stayed green. Measured, not assumed.',
      '  const m = /test\\("(.*?)"\\)/.exec(jq);',
      '  const re = new RegExp(m ? m[1].replace(/\\\\\\\\/g, "\\\\") : "^$");',
      '  const mine = f.comments.filter((c) => re.test(c.author.login));',
      '  if (jq.includes("unique")) {',
      '    console.log([...new Set(f.comments.map((c) => c.author.login))].join(", "));',
      '  } else {',
      '    console.log(JSON.stringify(mine.at(-1) ?? {}));',
      '  }',
      '  process.exit(0);',
      '}',
      'if (args.includes("pr checks")) { process.exit(0); }',
      'process.exit(1);',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);

  return `${dir}:${process.env.PATH}`;
}

function judge(world, command = 'cd /repo && gh pr merge 7 --merge') {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, PATH: stubbedPath(world), CLAUDE_PROJECT_DIR: WORKSPACE_ROOT },
  });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * A review as the reviewer is contracted to write one: prose, then the count on the last line.
 * Cases that mean to test an ABSENT count pass a body without it, deliberately.
 */
const REVIEW = (createdAt, body = 'looks fine\nACTIONABLE FINDINGS: 0') => ({
  author: { login: 'github-actions' },
  createdAt,
  body,
});

describe('the merge gate decides on CI and on a current review', () => {
  it('allows a merge when CI is clean and the review is newer than the head', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z')],
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output).toMatch(/READ IT/);
  });

  it('refuses when CI is not clean', () => {
    const verdict = judge({
      state: 'BLOCKED',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z')],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/BLOCKED, not CLEAN/);
  });

  it('refuses a review older than the commit it would merge', () => {
    // A review that predates the head has not seen what is about to land.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T09:00:00Z')],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/predates its head commit/);
  });

  it('refuses while the review reports findings', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z', 'ACTIONABLE FINDINGS: 2\nfix them')],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/ACTIONABLE FINDINGS: 2/);
  });

  it('refuses when the review carries no count', () => {
    // Absence was a warning and an exit 0, argued from measurement: 4 of the 38 most recent reviews
    // carried the marker, and refusing would have made the override routine. That argument is spent
    // — the count is required of the reviewer now, and the review that forced this change carried
    // it. What remains is this script's own rule, which the findings check was the one exception to.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z', 'prose only, no marker')],
    });

    expect(verdict.status, 'an uncountable review was merged past').toBe(2);
    expect(verdict.output).toMatch(/carries no 'ACTIONABLE FINDINGS/);
  });

  it('reads the last count in the body, not the first', () => {
    // The contract puts the count on the summary's final line, and a review quoting an earlier
    // round carries that round's number ahead of its own — `head -1` then read the stale one.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        REVIEW(
          '2026-07-28T10:05:00Z',
          'last round said ACTIONABLE FINDINGS: 3, all fixed.\nACTIONABLE FINDINGS: 0',
        ),
      ],
    });

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('allows when the review reports zero findings', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z', 'ACTIONABLE FINDINGS: 0')],
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output, 'a counted zero must not read like an absent count').toMatch(
      /ACTIONABLE FINDINGS: 0/,
    );
  });

  it('refuses when the head commit date cannot be read', () => {
    // "I could not check" and "it is fine" are the two states a guard must never conflate.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '',
      comments: [REVIEW('2026-07-28T10:05:00Z')],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/head commit date/);
  });

  it('names a reviewer mismatch instead of reporting no review', () => {
    // The failure review predicted: if the reviewing account's login stops matching, every merge is
    // refused forever with a message pointing at the wrong cause, and the override becomes routine.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        { author: { login: 'someone-else' }, createdAt: '2026-07-28T10:05:00Z', body: '' },
      ],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output, 'a login mismatch was reported as a missing review').toMatch(
      /no comment on #\d+ is from the reviewer this gate looks for/,
    );
    expect(verdict.output, 'the message does not say which logins were seen').toMatch(
      /someone-else/,
    );
  });

  it('accepts the reviewer under either spelling of the bot login', () => {
    // Measured on this repository: gh reports `github-actions`. The `[bot]` spelling is accepted
    // too, because the normalisation is gh's to change and a silent stop would block every merge.
    for (const login of ['github-actions', 'github-actions[bot]']) {
      const verdict = judge({
        state: 'CLEAN',
        headAt: '2026-07-28T10:00:00Z',
        comments: [
          {
            author: { login },
            createdAt: '2026-07-28T10:05:00Z',
            body: 'fine\nACTIONABLE FINDINGS: 0',
          },
        ],
      });

      expect(verdict.status, `${login} was not recognised as the reviewer`).toBe(0);
    }
  });

  it('honours an inline override, and says it did not verify', () => {
    const verdict = judge(
      { state: 'BLOCKED', headAt: '', comments: [] },
      'MERGE_GATE_ACK=1 gh pr merge 7 --merge',
    );

    expect(verdict.status).toBe(0);
    expect(verdict.output, 'an override that does not announce itself is a silent bypass').toMatch(
      /NOT verified/,
    );
  });

  it('ignores an override attached to some other statement', () => {
    // The override is documented as a visible, deliberate choice about THIS merge. Matched anywhere
    // in the command, `MERGE_GATE_ACK=1 date; gh pr merge 7 --merge` disarmed the gate with an
    // assignment that belongs to an unrelated statement and never reaches the merge at all.
    const verdict = judge(
      { state: 'BLOCKED', headAt: '', comments: [] },
      'MERGE_GATE_ACK=1 date; gh pr merge 7 --merge',
    );

    expect(verdict.status, 'an override bound to another statement disarmed the gate').toBe(2);
  });

  it('honours an override written after a cd', () => {
    // The other side of that boundary: `cd <repo> && MERGE_GATE_ACK=1 gh pr merge` is the ordinary
    // spelling, and tightening the match must not cost it.
    const verdict = judge(
      { state: 'BLOCKED', headAt: '', comments: [] },
      'cd /repo && MERGE_GATE_ACK=1 gh pr merge 7 --merge',
    );

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('says nothing about a command that is not a merge', () => {
    const verdict = judge({ state: 'CLEAN', headAt: '', comments: [] }, 'git status');

    expect(verdict.status).toBe(0);
    expect(verdict.output.trim()).toBe('');
  });
});
