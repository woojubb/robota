import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/merge-gate.sh');
const BASE_OID = '1111111111111111111111111111111111111111';
const HEAD_OID = '2222222222222222222222222222222222222222';
const VERDICT_MARKERS = `REVIEWED BASE: ${BASE_OID}\nREVIEWED HEAD: ${HEAD_OID}`;

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
function stubbedPath({
  state,
  comments = [],
  reviews = [],
  headAt,
  baseOid = BASE_OID,
  headOid = HEAD_OID,
  labels = [],
  unresolved = 0,
  resolvedWithoutReply = 0,
  totalThreads,
  threadsUnreadable = false,
}) {
  const dir = makeTemp('merge-gate-');
  scratch.push(dir);

  const fixture = path.join(dir, 'fixture.json');
  writeFileSync(
    fixture,
    JSON.stringify({
      state,
      comments,
      reviews,
      headAt,
      baseOid,
      headOid,
      labels,
      unresolved,
      resolvedWithoutReply,
      totalThreads,
      threadsUnreadable,
    }),
  );

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
      '  // Answer the shape the HOOK asked for. A stub answering its own preferred shape would keep',
      '  // reporting "no labels" after the hook changed, which reads exactly like "not withdrawn".',
      '  if (jq.includes("__labels__")) console.log(["__labels__", ...names].join("\\n"));',
      '  else console.log(names.join(","));',
      '  process.exit(0);',
      '}',
      'if (args.includes("mergeStateStatus")) { console.log(f.state); process.exit(0); }',
      'if (args.includes("baseRefOid") && args.includes("headRefOid")) {',
      '  console.log(`${f.baseOid ?? ""} ${f.headOid ?? ""}`);',
      '  process.exit(0);',
      '}',
      'if (args.includes("--json commits")) { console.log(f.headAt ?? ""); process.exit(0); }',
      'if (args.includes("--json comments")) {',
      '  const jq = process.argv[process.argv.indexOf("--jq") + 1] ?? "";',
      '  // Apply the pattern the HOOK passed, never one written here. Filtering by a copy of the',
      '  // expected login made every case pass no matter what the hook looked for — the wrong',
      '  // reviewer name, the exact defect under test, stayed green. Measured, not assumed.',
      '  const m = /test\\("(.*?)"\\)/.exec(jq);',
      '  const re = new RegExp(m ? m[1].replace(/\\\\\\\\/g, "\\\\") : "^$");',
      '  if (jq.includes("unique")) {',
      '    // The diagnostic reads BOTH channels too (#1668 review) — a stub answering only the',
      '    // comments would keep the misdiagnosis this widening removed invisible.',
      '    const logins = [...f.comments, ...(f.reviews ?? [])].map((c) => c.author.login);',
      '    console.log([...new Set(logins)].join(", "));',
      '    process.exit(0);',
      '  }',
      '  // #1661: the hook selects the newest VERDICT across comments AND reviews. The stub',
      '  // honours each clause the query actually carries — author filter, marker filter when the',
      '  // query asks for it, sort by timestamp — so a hook that stopped asking for the marker',
      '  // would be answered accordingly and the case for it would fail.',
      '  const entries = [',
      '    ...f.comments.map((c) => ({ login: c.author.login, body: c.body ?? "", at: c.createdAt ?? "" })),',
      '    ...(f.reviews ?? []).map((r) => ({ login: r.author.login, body: r.body ?? "", at: r.submittedAt ?? "" })),',
      '  ];',
      '  let mine = entries.filter((c) => re.test(c.login));',
      '  if (jq.includes("ACTIONABLE FINDINGS")) {',
      '    mine = mine.filter((c) => /actionable findings:\\s*[0-9]+/i.test(c.body));',
      '  }',
      '  mine.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));',
      '  console.log(JSON.stringify(mine.at(-1) ?? {}));',
      '  process.exit(0);',
      '}',
      '// The gate asks whether every inline finding was ANSWERED where it was raised. These cases',
      '// are about other properties, so they answer "none open" — the state that lets the rest of',
      '// the gate be judged. The thread check itself has its own cases below.',
      'if (args.includes("repo view")) { console.log("woojubb/robota"); process.exit(0); }',
      'if (args.includes("reviewThreads")) {',
      '  if (f.threadsUnreadable) process.exit(1);',
      '  // The hook asks for TWO numbers in one read: how many threads came back, and how many of',
      "  // those are the reviewer's and still open. A stub answering only the second would let a",
      '  // truncated page read as a short one.',
      '  // Answer the QUERY the hook sent, not a number computed here. A stub that summed the two',
      '  // states itself reported the same total whichever filter the hook used, so changing the',
      '  // filter changed nothing and the case proved nothing — measured, and the reason this reads',
      '  // the jq expression instead.',
      '  const wantsReplyCount = args.includes("totalCount < 2");',
      '  const unsatisfied = (f.unresolved ?? 0) + (wantsReplyCount ? (f.resolvedWithoutReply ?? 0) : 0);',
      '  console.log(`${f.totalThreads ?? f.unresolved ?? 0} ${unsatisfied}`);',
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
const REVIEW = (
  createdAt,
  body = 'looks fine\nACTIONABLE FINDINGS: 0',
  { baseOid = BASE_OID, headOid = HEAD_OID } = {},
) => ({
  author: { login: 'github-actions' },
  createdAt,
  body: /ACTIONABLE FINDINGS:/i.test(body)
    ? `REVIEWED BASE: ${baseOid}\nREVIEWED HEAD: ${headOid}\n${body}`
    : body,
});

describe('the merge gate decides on CI and on a current review', () => {
  it('allows a merge when CI is clean and the review names the exact current pair', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z')],
    });

    expect(verdict.status, verdict.output).toBe(0);
    expect(verdict.output).toMatch(/READ IT/);
  });

  it('refuses a zero-finding verdict for a stale base SHA', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        REVIEW('2026-07-28T10:05:00Z', undefined, {
          baseOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
      ],
    });

    expect(verdict.status, 'a verdict for another base was accepted').toBe(2);
    expect(verdict.output).toMatch(/base.*does not match/i);
  });

  it('refuses a zero-finding verdict for a stale head SHA', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        REVIEW('2026-07-28T10:05:00Z', undefined, {
          headOid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        }),
      ],
    });

    expect(verdict.status, 'a verdict for another head was accepted').toBe(2);
    expect(verdict.output).toMatch(/head.*does not match/i);
  });

  it.each([
    ['missing head', `REVIEWED BASE: ${BASE_OID}\nACTIONABLE FINDINGS: 0`],
    [
      'malformed base',
      `REVIEWED BASE: not-a-sha\nREVIEWED HEAD: ${HEAD_OID}\nACTIONABLE FINDINGS: 0`,
    ],
    [
      'duplicate base',
      `REVIEWED BASE: ${BASE_OID}\nREVIEWED BASE: ${BASE_OID}\nREVIEWED HEAD: ${HEAD_OID}\nACTIONABLE FINDINGS: 0`,
    ],
    ['duplicate count', `${VERDICT_MARKERS}\nACTIONABLE FINDINGS: 0\nACTIONABLE FINDINGS: 0`],
  ])('refuses a %s verdict identity', (_label, body) => {
    const verdict = judge({
      state: 'CLEAN',
      comments: [{ author: { login: 'github-actions' }, createdAt: '2026-07-28T10:05:00Z', body }],
    });

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/exactly one REVIEWED BASE/);
  });

  it('refuses unreadable current OIDs', () => {
    const verdict = judge({
      state: 'CLEAN',
      baseOid: '',
      comments: [REVIEW('2026-07-28T10:05:00Z')],
    });

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/could not read.*base\/head OIDs/i);
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

  it('uses exact comparison identity instead of timestamp ordering', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T09:00:00Z')],
    });

    expect(verdict.status, verdict.output).toBe(0);
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

  it('refuses when the reviewer never delivered a verdict', () => {
    // Absence was a warning and an exit 0, argued from measurement; that argument is spent — the
    // count is required of the reviewer now. #1661 sharpened the diagnosis: the reviewer WROTE
    // (prose, notices, replies) but no entry of theirs carries the marker, and the refusal now
    // says that instead of implying the newest comment was a review missing a line.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T10:05:00Z', 'prose only, no marker')],
    });

    expect(verdict.status, 'an uncountable review was merged past').toBe(2);
    expect(verdict.output).toMatch(/never delivered a verdict/);
  });

  it('diagnoses a verdict-less REVIEWS-channel entry as the same third silence', () => {
    // The diagnostic reads both channels like the selection does (#1668 review): a reviewer that
    // spoke only through a pull-request review with no marker is "spoke, no verdict" — not the
    // generic "carries no review comment" that misnames what happened.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [],
      reviews: [
        {
          author: { login: 'github-actions' },
          submittedAt: '2026-07-28T10:05:00Z',
          body: 'prose only, no marker',
        },
      ],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output, 'a reviews-only silence was misdiagnosed').toMatch(
      /never delivered a verdict/,
    );
  });

  it('routes a login merely CONTAINING the reviewer name to "wrong reviewer"', () => {
    // The diagnostic judges logins with the same anchored pattern the selection uses — an
    // unanchored substring match sent `not-github-actions-fan` into "never delivered a verdict".
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        {
          author: { login: 'not-github-actions-fan' },
          createdAt: '2026-07-28T10:05:00Z',
          body: 'prose',
        },
      ],
    });

    expect(verdict.status).toBe(2);
    expect(verdict.output, 'a containing login was read as the reviewer').toMatch(
      /no comment on #\d+ is from the reviewer/,
    );
  });

  // ── #1661: the newest comment is not the verdict ──────────────────────────────────────────────

  it('does not let a fresh GATE NOTICE stand in for the verdict', () => {
    // The reviewing bot posts more than reviews under one login. The newest github-actions comment
    // here is a review-gate BLOCKED notice with no marker; the real verdict — zero findings, newer
    // than the head — sits one entry earlier. Selecting by author alone turned this PR into a
    // "carries no ACTIONABLE FINDINGS" refusal, and every merge into MERGE_GATE_ACK=1 — the
    // routine override the gate exists to prevent.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        REVIEW('2026-07-28T10:05:00Z', 'all clear\nACTIONABLE FINDINGS: 0'),
        REVIEW('2026-07-28T10:07:00Z', '**Review gate: BLOCKED**\nverdict-unavailable'),
      ],
    });

    expect(verdict.status, 'a gate notice displaced the verdict').toBe(0);
  });

  it('does not let a fresh notice displace an exact-pair verdict', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [
        REVIEW('2026-07-28T09:50:00Z', 'old round\nACTIONABLE FINDINGS: 0'),
        REVIEW('2026-07-28T10:07:00Z', '**Review gate: BLOCKED**\nverdict-unavailable'),
      ],
    });

    expect(verdict.status, verdict.output).toBe(0);
  });

  it('reads a verdict delivered on the REVIEWS channel', () => {
    // The other half of #1661: the reviewer sometimes writes a pull-request REVIEW (measured on
    // #1651 with a zero-length body, but the substantive form exists too). A verdict is a verdict
    // whichever channel carries it.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [],
      reviews: [
        {
          author: { login: 'github-actions' },
          submittedAt: '2026-07-28T10:05:00Z',
          body: `${VERDICT_MARKERS}\nreviewed as a PR review\nACTIONABLE FINDINGS: 0`,
        },
      ],
    });

    expect(verdict.status, 'a reviews-channel verdict went unread').toBe(0);
  });

  it('ignores a ZERO-LENGTH review — silence is not a verdict', () => {
    // Measured fact 1 of #1661: the newest review on #1651 had bodylen=0 and postdated the head,
    // so it satisfied "a review exists" while carrying nothing. It must satisfy nothing here.
    const verdict = judge({
      state: 'CLEAN',
      headAt: '2026-07-28T10:00:00Z',
      comments: [REVIEW('2026-07-28T09:50:00Z', 'old round\nACTIONABLE FINDINGS: 0')],
      reviews: [
        { author: { login: 'github-actions' }, submittedAt: '2026-07-28T10:07:00Z', body: '' },
      ],
    });

    expect(verdict.status, verdict.output).toBe(0);
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

  it('does not depend on the head commit date when the exact OIDs are readable', () => {
    const verdict = judge({
      state: 'CLEAN',
      headAt: '',
      comments: [REVIEW('2026-07-28T10:05:00Z')],
    });

    expect(verdict.status, verdict.output).toBe(0);
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
            body: `${VERDICT_MARKERS}\nfine\nACTIONABLE FINDINGS: 0`,
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

describe('every inline finding is answered where it was raised', () => {
  /**
   * The gate already asked "has the review been read and resolved?" and answered it from the summary
   * comment's findings count. That misses the half a reader actually sees. Measured across one
   * session: 27 inline threads left OPEN on 18 merged pull requests — every finding genuinely fixed,
   * with the reasoning in a commit message the thread does not link to. On the pull-request page a
   * fixed finding and an ignored one are then the same thing: a comment with no answer under it.
   */
  const world = (unresolved) => ({
    state: 'CLEAN',
    headAt: '2020-01-01T00:00:00Z',
    comments: [
      {
        author: { login: 'github-actions' },
        createdAt: '2030-01-01T00:00:00Z',
        body: `${VERDICT_MARKERS}\nACTIONABLE FINDINGS: 0`,
      },
    ],
    unresolved,
  });

  it('refuses a merge while a thread is still open', () => {
    const verdict = judge(world(2));

    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/2 unresolved REVIEW finding thread\(s\)/);
    expect(verdict.output, 'the refusal does not say what answering means').toMatch(
      /Reply on the thread/,
    );
  });

  it('lets it through when every thread is answered', () => {
    expect(judge(world(0)).status, judge(world(0)).output).toBe(0);
  });

  it('refuses a thread resolved with no reply under it', () => {
    // Anyone can click "Resolve conversation" on a thread with no answer. A gate reading only
    // `isResolved` would accept exactly the state it was built to end — a finding with no reply,
    // indistinguishable from one that was handled. Review caught this in the change that added the
    // check, which had made resolution alone sufficient.
    const verdict = judge({ ...world(0), resolvedWithoutReply: 1 });

    expect(verdict.status, verdict.output).toBe(2);
    expect(verdict.output).toMatch(/1 unresolved REVIEW finding thread/);
  });

  it('refuses a FULL page, because the rest can no longer be proven resolved', () => {
    // The same reasoning the label read one section up spells out, and the same check. Without it a
    // pull request with more than a page of threads could carry an open finding on a page this never
    // read and merge on a count of zero — the "unknown is not zero" this block is built on.
    const verdict = judge({ ...world(0), totalThreads: 100 });

    expect(verdict.status).toBe(2);
    expect(verdict.output).toMatch(/full page of 100 review threads/);
  });

  it('does not refuse a short page', () => {
    expect(judge({ ...world(0), totalThreads: 99 }).status).toBe(0);
  });

  it("lets threads through when none of them are the reviewer's to answer", () => {
    // Named for what it actually decides. The stub answers from the two NUMBERS the query returns,
    // so the authorship filter that produced the zero is not exercised here whatever the name says —
    // this case proves the hook does not refuse on the mere EXISTENCE of threads, which is a
    // different property and worth its own case.
    //
    // Where the filtering itself is proven is the jq block below, which runs the hook's own program
    // over payloads carrying real authors. The split is deliberate: a stub cannot test a filter it
    // is standing in for, and a name claiming otherwise is the comment-asserted-invariant defect
    // this repository keeps measuring in its own work — caught here by review, on this file.
    const asideOnly = judge({ ...world(0), totalThreads: 3 });

    expect(asideOnly.status, asideOnly.output).toBe(0);
  });

  it('refuses when it cannot read the thread state at all', () => {
    // Unknown is not zero. The same fail-closed rule this gate applies to unreadable current OIDs.
    const verdict = judge({ ...world(0), unresolved: undefined, threadsUnreadable: true });

    expect(verdict.status).toBe(2);
  });
});

describe('the jq program the hook actually sends', () => {
  /**
   * Every case above stubs `gh` at the process boundary and fabricates the two numbers, so none of
   * them ever ran the filter. A typo in it fails closed at best — blocking every merge — and at
   * worst matches nothing, which makes the whole enforcement a permanent no-op that looks green.
   *
   * So this reads the filter OUT OF THE HOOK and runs it over a realistic payload. A copy pasted
   * here would drift from the hook the first time either changed, and then this case would prove
   * something about a program nobody runs.
   */
  const HOOK_SOURCE = readFileSync(HOOK, 'utf8');
  // Read the pattern from the hook too. Restating it here is a second copy of a value the hook
  // owns, and the first attempt got its escaping wrong — jq rejected the program, which looked
  // like the hook was broken when it was the test that was.
  const REVIEWER_RE = /^REVIEWER_RE='(.*)'$/m.exec(HOOK_SOURCE)?.[1] ?? '';

  function filterFromHook() {
    const start = HOOK_SOURCE.indexOf("--jq '.data.repository.pullRequest.reviewThreads.nodes");
    expect(
      start,
      'the hook no longer contains the thread query — this case is reading nothing',
    ).toBeGreaterThan(-1);
    const end = HOOK_SOURCE.indexOf("' || echo", start);
    // Shell splices the reviewer pattern in by closing and reopening the quote; undo exactly that.
    return HOOK_SOURCE.slice(start + "--jq '".length, end).replace(
      /'"\$REVIEWER_RE"'/g,
      REVIEWER_RE,
    );
  }

  function run(threads) {
    const payload = JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: threads } } } },
    });
    const result = spawnSync('jq', ['-r', filterFromHook()], { input: payload, encoding: 'utf8' });
    expect(result.status, `jq rejected the hook's own program: ${result.stderr}`).toBe(0);
    return result.stdout.trim();
  }

  const thread = (login, isResolved, totalCount) => ({
    isResolved,
    comments: { totalCount, nodes: [{ author: { login } }] },
  });

  it('counts a reviewer thread that is unresolved', () => {
    expect(run([thread('github-actions', false, 1)])).toBe('1 1');
  });

  it('counts a reviewer thread resolved with no reply', () => {
    expect(run([thread('github-actions', true, 1)])).toBe('1 1');
  });

  it('does not count a reviewer thread that is resolved AND answered', () => {
    expect(run([thread('github-actions', true, 2)])).toBe('1 0');
  });

  it("does not count a human's thread, however open", () => {
    expect(run([thread('someone', false, 1)])).toBe('1 0');
  });

  it('survives a comment whose author is gone', () => {
    // GraphQL returns a null author for a deleted or ghost account. `test()` on null does not
    // return false — it THROWS, which fails the whole `gh api` call, which the gate reads as
    // could-not-read-threads and refuses. So one deleted account anywhere in a PR's threads would
    // block that PR's merges permanently, on an otherwise clean tree, with a message naming the
    // wrong cause. Fail-closed is right when the state is genuinely unreadable; this state is
    // readable and the thread simply is not the reviewer's.
    const ghost = { isResolved: false, comments: { totalCount: 1, nodes: [{ author: null }] } };

    expect(run([ghost])).toBe('1 0');
    // And it still counts the reviewer's thread standing beside it, rather than taking the whole
    // filter down — the property that makes this a guard instead of a switch.
    expect(run([ghost, thread('github-actions', false, 1)])).toBe('2 1');
  });

  it('reports the TOTAL separately from the unsatisfied count', () => {
    // The total is what the full-page check reads; conflating the two would hide truncation.
    const threads = [
      thread('github-actions', true, 2),
      thread('someone', false, 1),
      thread('github-actions', false, 1),
    ];
    expect(run(threads)).toBe('3 1');
  });
});

describe('the verdict-selection jq program the hook actually sends', () => {
  /**
   * Same reasoning as the thread-query block above (#1668 review): every verdict case stubs `gh`
   * with a JS reimplementation of the filter, so a syntax or escaping regression in the hook's own
   * jq program would stay invisible while the cases stayed green. This reads the program OUT OF
   * THE HOOK and runs it under the real jq.
   */
  const HOOK_SOURCE = readFileSync(HOOK, 'utf8');
  const REVIEWER_RE = /^REVIEWER_RE='(.*)'$/m.exec(HOOK_SOURCE)?.[1] ?? '';

  function verdictFilterFromHook() {
    const start = HOOK_SOURCE.indexOf('--jq "([.comments[]');
    expect(
      start,
      'the hook no longer contains the verdict query — this case is reading nothing',
    ).toBeGreaterThan(-1);
    const end = HOOK_SOURCE.indexOf('" || echo', start);
    // The program sits in shell double quotes: `\"` is a literal quote, and $REVIEWER_RE splices
    // its (jq-escaped) value in place. Undo exactly those two.
    return HOOK_SOURCE.slice(start + '--jq "'.length, end)
      .replace(/\\"/g, '"')
      .replace(/\$REVIEWER_RE/g, REVIEWER_RE);
  }

  function pick(payload) {
    const result = spawnSync('jq', ['-c', verdictFilterFromHook()], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    expect(result.status, `jq rejected the hook's own program: ${result.stderr}`).toBe(0);
    return JSON.parse(result.stdout.trim());
  }

  it('selects the newest MARKED entry across both channels, not the newest entry', () => {
    const out = pick({
      comments: [
        {
          author: { login: 'github-actions' },
          createdAt: '2026-08-01T10:00:00Z',
          body: 'ACTIONABLE FINDINGS: 0',
        },
        {
          author: { login: 'github-actions' },
          createdAt: '2026-08-01T12:00:00Z',
          body: 'a gate notice, no marker',
        },
      ],
      reviews: [
        {
          author: { login: 'github-actions' },
          submittedAt: '2026-08-01T11:00:00Z',
          body: 'fine\nACTIONABLE FINDINGS: 2',
        },
      ],
    });

    expect(out.at).toBe('2026-08-01T11:00:00Z');
    expect(out.body).toMatch(/ACTIONABLE FINDINGS: 2/);
  });

  it('matches the [bot] login spelling through the spliced pattern', () => {
    const out = pick({
      comments: [
        {
          author: { login: 'github-actions[bot]' },
          createdAt: '2026-08-01T10:00:00Z',
          body: 'ACTIONABLE FINDINGS: 0',
        },
      ],
      reviews: [],
    });

    expect(out.at).toBe('2026-08-01T10:00:00Z');
  });

  it('returns an empty object when nothing carries the marker', () => {
    const out = pick({
      comments: [
        { author: { login: 'github-actions' }, createdAt: '2026-08-01T10:00:00Z', body: 'silence' },
      ],
      reviews: [],
    });

    expect(out).toEqual({});
  });
});
