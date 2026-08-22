/**
 * A new task record names the issue that registered it (issue #1916, second half).
 *
 * The first half — one ID, one tracked record — is decidable offline and landed as
 * `work-item-id-collision`. The half that actually bit is an ID claimed by a record in one clone and
 * by an ISSUE TITLE opened by another session, and it is undecidable while nothing says which issue
 * registers which record. These cases are about producing that link, not about using it: the exact
 * cross-source comparison needs it on both sides, and today it is on one.
 */

import { describe, expect, it } from 'vitest';

import {
  ISSUE_LINK_PATTERNS,
  isPhaseRecord,
  isTaskRecord,
  linkCoverage,
  namesItsIssue,
} from '../task-record-issue-link.mjs';

describe('what counts as naming the issue', () => {
  it.each([
    ['Registered as [issue #1811](https://github.com/o/r/issues/1811).', 'the registered-as form'],
    ['See issue #1916 for the measurement.', 'a bare issue reference'],
    ['Filed at https://github.com/woojubb/robota/issues/42', 'an issue URL'],
  ])('accepts %s (%s)', (content) => {
    expect(namesItsIssue(content)).toBe(true);
  });

  it.each([
    ['# SOME-001\n\nJust prose.', 'no citation at all'],
    ['See PR #1811 for the change.', 'a PULL REQUEST, which is not the registration'],
    ['Related to SOME-002.', 'another work-item id, which is not an issue'],
    ['https://github.com/o/r/pull/42', 'a pull request URL'],
  ])('refuses %s (%s)', (content) => {
    expect(namesItsIssue(content)).toBe(false);
  });

  it('accepts an explicit opt-out, so a genuine exception is written down', () => {
    expect(namesItsIssue('no-issue: a phase of ARCH-002, which carries the registration')).toBe(
      true,
    );
  });

  it('does not accept an opt-out with no reason', () => {
    // The point of the escape is the judgement written beside it. A bare marker is not one.
    expect(namesItsIssue('no-issue:')).toBe(false);
    expect(namesItsIssue('no-issue:   ')).toBe(false);
  });

  it('offers exactly the three spellings already in the tree, and no fourth', () => {
    // Measured before landing: `Registered as … issue #N` in 8 records, a bare `issue #N` in 46, an
    // issue URL in 65. Inventing a fourth spelling here would make a record that already links have
    // to link again.
    expect(ISSUE_LINK_PATTERNS).toHaveLength(3);
  });
});

describe('which files are judged', () => {
  it.each([
    ['.agents/tasks/INFRA-047-deny-licenses.md', true],
    ['.agents/tasks/completed/SEC-011-same-user-proof.md', true],
  ])('%s is a task record', (file, expected) => {
    expect(isTaskRecord(file)).toBe(expected);
  });

  it.each([
    ['.agents/tasks/README.md', 'the directory README carries no id'],
    ['.agents/tasks/notes.md', 'an un-prefixed file'],
    ['packages/agent-core/INFRA-047-notes.md', 'a path outside the tasks tree'],
    ['.agents/tasks/INFRA-047-deny-licenses.txt', 'a non-markdown file'],
  ])('%s is not (%s)', (file) => {
    expect(isTaskRecord(file)).toBe(false);
  });

  it('exempts a phase, which carries its parent registration', () => {
    // Same convention `work-item-id-collision` uses for the same reason: a phase is not a second
    // item, so asking it to name its own issue would ask for one that does not exist.
    expect(isPhaseRecord('.agents/tasks/completed/ARCH-002-p7-slim-agent-cli-public-api.md')).toBe(
      true,
    );
    expect(isPhaseRecord('.agents/tasks/SELFHOST-003-P4-embedding-vector-backend.md')).toBe(true);
  });

  it('does not exempt a parent whose slug merely starts with p', () => {
    expect(isPhaseRecord('.agents/tasks/PLAN-001-plan-completed-state.md')).toBe(false);
    expect(isPhaseRecord('.agents/tasks/completed/CLI-001-prompt-input-non-tty-guard.md')).toBe(
      false,
    );
  });
});

describe('the size reported is BOTH halves of the population', () => {
  /*
   * A consumer of these links that reported its size as "records carrying a link" would be naming
   * the population it can SEE and calling it the population. A later cross-source scan reporting
   * "no collisions" over a set that silently excludes every unlinked record is issue #1916's own
   * failure, one layer up — so the pair is what makes the gap visible.
   */
  const files = {
    '.agents/tasks/A-001-linked.md': 'Registered as issue #1.',
    '.agents/tasks/B-002-bare.md': 'nothing here',
    '.agents/tasks/C-003-optout.md': 'no-issue: a probe',
    '.agents/tasks/README.md': 'not a record',
    '.agents/tasks/D-004-p1-phase.md': 'a phase, exempt',
  };
  const read = (f) => {
    if (!(f in files)) throw new Error('unreadable');
    return files[f];
  };

  it('counts linked and unlinked separately, and skips what is not judged', () => {
    expect(linkCoverage(Object.keys(files), read)).toEqual({ linked: 2, unlinked: 1 });
  });

  it('counts an UNREADABLE record as unlinked, never as absent', () => {
    // A record this cannot open is a record a consumer cannot compare. Dropping it would shrink the
    // denominator silently, which is the exact shape the pair exists to report.
    expect(linkCoverage(['.agents/tasks/E-005-gone.md'], read)).toEqual({ linked: 0, unlinked: 1 });
  });

  it('reports zero for an empty subject rather than nothing at all', () => {
    expect(linkCoverage([], read)).toEqual({ linked: 0, unlinked: 0 });
  });
});
