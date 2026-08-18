/**
 * INFRA-104 — the promotion carries the closing keywords, because nothing else can.
 *
 * GitHub reads `Closes #N` only on a pull request that targets the DEFAULT branch. Work here flows
 * feature → develop → main, so the keyword every work PR writes is ignored, no link is created, and
 * the issue stays open until a person closes it by hand. Measured on PR #1802 (`Closes #1750`) and
 * PR #1816 (`Closes #1722`): both merged, both issues still open days later.
 *
 * These suites pin the two facts that decide whether the derivation can work at all, both measured
 * against this repository before the code was written:
 *
 *  1. The keyword lives in the PR BODY, not the commit. `git log -1 --format=%B 93d061dd3` — the
 *     squash of PR #1802 — carries no `Closes` line, because GitHub's squash body concatenates the
 *     commit messages rather than the PR description. A derivation reading commit messages would
 *     return an empty block and look like a clean promotion.
 *  2. A `Closes` target is not always an issue. PR #1801's body opens `Closes PROV-007.` — a Task ID.
 *     And `#N` may name a pull request rather than an issue.
 *
 * Every fail-closed edge is asserted rather than assumed: an unreadable body must abort the whole
 * derivation, never shorten the block. A short block is indistinguishable from a clean one, which is
 * the same silent-truncation shape SEC-006 measured on the alerts endpoint.
 */

import { describe, expect, it } from 'vitest';

import {
  collectClosingLines,
  examinedIssueRecordCount,
  examinedPullBodyCount,
  extractIssueReferences,
  parsePullRequestNumbers,
  renderBlock,
} from '../promotion-closes.mjs';

/** The subjects `git log --format=%s origin/main..origin/develop` produced on 2026-08-17. */
const MEASURED_SUBJECTS = [
  'fix(triage): close seven open GitHub issues from the priority triage (#1804)',
  'docs(harness): define issue and task boundaries (#1813)',
  'feat(agent-core): decide the structured-output transport before the first call (CORE-043) (#1802)',
  'fix(agent-provider-openai): strictTools sent a schema OpenAI refuses (#1801)',
  'refactor(agent-core,providers): three payloads in one struct become three things (#1799)',
];

function readerFrom(bodies, states) {
  return {
    readPullBody: (n) => {
      if (!(n in bodies)) throw new Error(`pull #${n} is unreadable`);
      return bodies[n];
    },
    readIssueState: (n) => {
      if (!(n in states)) throw new Error(`issue #${n} is unreadable`);
      return states[n];
    },
  };
}

describe('parsePullRequestNumbers', () => {
  it('takes the trailing (#N) GitHub appends to every squash subject', () => {
    expect(parsePullRequestNumbers(MEASURED_SUBJECTS)).toEqual([1804, 1813, 1802, 1801, 1799]);
  });

  it('ignores a subject with no pull-request suffix — a promotion merge commit has none', () => {
    expect(
      parsePullRequestNumbers(["chore(release): record main's ancestry into the promotion"]),
    ).toEqual([]);
  });

  it('takes only the TRAILING reference, so an issue named mid-subject is not read as a PR', () => {
    expect(parsePullRequestNumbers(['fix: undo the change from #1409 (#1500)'])).toEqual([1500]);
  });
});

describe('extractIssueReferences', () => {
  it('reads every closing keyword form, case-insensitively', () => {
    const body = 'Closes #1. fixes #2\nResolved #3 — FIX #4, closed #5';
    expect(extractIssueReferences(body)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not read a Task ID as an issue — measured on PR #1801', () => {
    expect(
      extractIssueReferences('Closes PROV-007. With PROV-006 merged, CORE-043 is unblocked.'),
    ).toEqual([]);
  });

  it('does not read a bare cross-reference that carries no closing keyword', () => {
    expect(extractIssueReferences('This is the sibling of #1722 but does not close it.')).toEqual(
      [],
    );
  });

  it('de-duplicates a number referenced twice', () => {
    expect(extractIssueReferences('Closes #7. Fixes #7.')).toEqual([7]);
  });
});

describe('collectClosingLines', () => {
  it('emits one line per OPEN issue a carried pull request closes', () => {
    const { lines, issues } = collectClosingLines({
      pullNumbers: [1802, 1816],
      ...readerFrom(
        { 1802: 'Closes #1750.', 1816: 'Closes #1722. Task: ...' },
        {
          1750: { state: 'open', isPullRequest: false },
          1722: { state: 'open', isPullRequest: false },
        },
      ),
    });
    expect(lines).toEqual(['Closes #1750', 'Closes #1722']);
    expect(issues).toEqual([1750, 1722]);
  });

  it('drops an already-CLOSED issue — re-closing it would say nothing true', () => {
    const { lines } = collectClosingLines({
      pullNumbers: [1802],
      ...readerFrom({ 1802: 'Closes #1750.' }, { 1750: { state: 'closed', isPullRequest: false } }),
    });
    expect(lines).toEqual([]);
  });

  it('drops a #N that names a PULL REQUEST rather than an issue', () => {
    const { lines } = collectClosingLines({
      pullNumbers: [1802],
      ...readerFrom({ 1802: 'Closes #1799.' }, { 1799: { state: 'open', isPullRequest: true } }),
    });
    expect(lines).toEqual([]);
  });

  it('de-duplicates an issue two carried pull requests both claim', () => {
    const { lines } = collectClosingLines({
      pullNumbers: [1802, 1817],
      ...readerFrom(
        { 1802: 'Closes #1750.', 1817: 'Closes #1750 as well.' },
        { 1750: { state: 'open', isPullRequest: false } },
      ),
    });
    expect(lines).toEqual(['Closes #1750']);
  });

  it('THROWS on an unreadable pull-request body — it must never emit a SHORT block', () => {
    expect(() =>
      collectClosingLines({
        pullNumbers: [1802, 9999],
        ...readerFrom({ 1802: 'Closes #1750.' }, { 1750: { state: 'open', isPullRequest: false } }),
      }),
    ).toThrow(/#9999/);
  });

  it('THROWS on an unreadable issue state for the same reason', () => {
    expect(() =>
      collectClosingLines({ pullNumbers: [1802], ...readerFrom({ 1802: 'Closes #1750.' }, {}) }),
    ).toThrow(/#1750/);
  });

  it('emits nothing when no carried pull request closes anything — a legitimate empty result', () => {
    const { lines } = collectClosingLines({
      pullNumbers: [1813],
      ...readerFrom({ 1813: 'Defines the issue/task boundary. No issue closed.' }, {}),
    });
    expect(lines).toEqual([]);
  });
});

describe('renderBlock', () => {
  it('renders nothing for an empty derivation, so no empty heading is pasted', () => {
    expect(renderBlock([])).toBe('');
  });

  it('renders each line on its own line so GitHub parses every keyword', () => {
    expect(renderBlock(['Closes #1750', 'Closes #1722'])).toContain('Closes #1750\nCloses #1722');
  });
});

describe('the published examined size', () => {
  /** Two bodies, three distinct references, one of which is a pull request and one already closed. */
  const readerFor = () => ({
    readPullBody: (n) => ({ 1802: 'Closes #1750.', 1799: 'Closes #1722. Fixes #1804.' })[n],
    readIssueState: (n) =>
      ({
        1750: { state: 'open', isPullRequest: false },
        1722: { state: 'closed', isPullRequest: false },
        1804: { state: 'open', isPullRequest: true },
      })[n],
  });

  it('counts the bodies READ and the issue records CHECKED, not the lines returned', () => {
    const { lines } = collectClosingLines({ pullNumbers: [1802, 1799], ...readerFor() });
    // One line survives the two filters, and the sizes must describe the WALK, not that result.
    expect(lines).toEqual(['Closes #1750']);
    expect(examinedPullBodyCount()).toBe(2);
    expect(examinedIssueRecordCount()).toBe(3);
  });

  it('starts from zero on a SECOND collection, so the size is this run and not the sum of runs', () => {
    collectClosingLines({ pullNumbers: [1802, 1799], ...readerFor() });
    collectClosingLines({ pullNumbers: [1802], ...readerFor() });
    expect(examinedPullBodyCount()).toBe(1);
    expect(examinedIssueRecordCount()).toBe(1);
  });
});
