/**
 * INFRA-104 — the guard that makes the promotion body load-bearing.
 *
 * `promotion-closes.mjs` DERIVES the block; nothing so far makes anyone paste it. A promotion whose
 * body silently omits a keyword closes nothing and looks exactly like a promotion that had nothing to
 * close — the same indistinguishable-from-clean shape the derivation itself fails closed against.
 *
 * This guard is a REQUIRED check on `protect-main` (owner decision D1, 2026-08-18), so both
 * directions are asserted here: it must go RED on a body missing an implied keyword, and it must go
 * GREEN when the body carries them. A required context that cannot fail is the vacuity INFRA-055
 * measured on promotion #1427, where five required contexts were no-ops.
 */

import { describe, expect, it } from 'vitest';

import {
  decidePromotionCloses,
  examinedIssueCount,
  findMissingKeywords,
  parseCommitSubjects,
} from '../scan-promotion-closes.mjs';
import { parsePullRequestNumbers } from '../promotion-closes.mjs';

describe('findMissingKeywords', () => {
  it('finds an issue the body never mentions', () => {
    expect(findMissingKeywords({ body: 'Closes #1750', requiredIssues: [1750, 1722] })).toEqual([
      1722,
    ]);
  });

  it('accepts any closing-keyword inflection, not just the one the deriver emits', () => {
    expect(findMissingKeywords({ body: 'Fixes #1722.', requiredIssues: [1722] })).toEqual([]);
  });

  it('does NOT accept a bare cross-reference — it closes nothing', () => {
    expect(findMissingKeywords({ body: 'Related to #1722.', requiredIssues: [1722] })).toEqual([
      1722,
    ]);
  });

  it('does not confuse #172 with #1722', () => {
    expect(findMissingKeywords({ body: 'Closes #172', requiredIssues: [1722] })).toEqual([1722]);
  });

  it('passes an empty requirement — a promotion may legitimately close nothing', () => {
    expect(findMissingKeywords({ body: '', requiredIssues: [] })).toEqual([]);
  });
});

describe('decidePromotionCloses', () => {
  it('is NOT APPLICABLE when the base is not the default branch', () => {
    const verdict = decidePromotionCloses({
      baseRef: 'develop',
      body: '',
      requiredIssues: [1722],
    });
    expect(verdict.applicable).toBe(false);
    expect(verdict.blocked).toBe(false);
  });

  it('BLOCKS a main-based pull request whose body omits an implied keyword', () => {
    const verdict = decidePromotionCloses({
      baseRef: 'main',
      body: 'Promotes develop to main.',
      requiredIssues: [1722],
    });
    expect(verdict.blocked).toBe(true);
    expect(verdict.missing).toEqual([1722]);
    expect(verdict.summary).toMatch(/#1722/);
  });

  it('PASSES a main-based pull request whose body carries every implied keyword', () => {
    const verdict = decidePromotionCloses({
      baseRef: 'main',
      body: 'Promotes develop to main.\n\nCloses #1722\nCloses #1750',
      requiredIssues: [1722, 1750],
    });
    expect(verdict.blocked).toBe(false);
    expect(verdict.missing).toEqual([]);
  });

  it('BLOCKS when the requirement could not be derived — unreadable is not clean', () => {
    const verdict = decidePromotionCloses({
      baseRef: 'main',
      body: 'Promotes develop to main.',
      requiredIssues: 'UNAVAILABLE',
    });
    expect(verdict.blocked).toBe(true);
    expect(verdict.summary).toMatch(/could not be derived/i);
  });
});

describe('the published examined size', () => {
  it('counts every required issue the body was checked against, not the ones found missing', () => {
    expect(
      findMissingKeywords({ body: 'Closes #1750', requiredIssues: [1750, 1722, 1804] }),
    ).toEqual([1722, 1804]);
    expect(examinedIssueCount()).toBe(3);
  });

  it('starts from zero on a SECOND check, so the size is this run and not the sum of runs', () => {
    findMissingKeywords({ body: 'Closes #1750', requiredIssues: [1750, 1722, 1804] });
    findMissingKeywords({ body: 'Closes #1750', requiredIssues: [1750] });
    expect(examinedIssueCount()).toBe(1);
  });

  it('is zero for a verdict that never walked the requirement, rather than a stale count', () => {
    findMissingKeywords({ body: 'Closes #1750', requiredIssues: [1750, 1722, 1804] });
    decidePromotionCloses({ baseRef: 'develop', body: '', requiredIssues: [] });
    expect(examinedIssueCount()).toBe(0);
  });
});

describe('parseCommitSubjects', () => {
  it('takes only the subject of a multi-line message', () => {
    const stdout = [
      JSON.stringify('feat(x): a thing (#1841)\n\nBody line one.\nBody line two.'),
      JSON.stringify('fix(y): another (#1843)'),
    ].join('\n');

    expect(parseCommitSubjects(stdout)).toEqual([
      'feat(x): a thing (#1841)',
      'fix(y): another (#1843)',
    ]);
  });

  it('does not read a body line that quotes another pull request as a carried one', () => {
    // The reason this guard needed the encoding: with raw `gh` output this body line arrived as its
    // own line of stdout, and `(#9999)` made it a pull request the promotion never carried. This
    // guard is required on `protect-main`, so that reading blocks a correct promotion.
    const stdout = JSON.stringify(
      'feat(z): the real subject (#1850)\n\nSupersedes the approach taken in (#9999)',
    );

    expect(parsePullRequestNumbers(parseCommitSubjects(stdout))).toEqual([1850]);
  });

  it('throws rather than guessing when a line is not JSON-encoded', () => {
    // The caller turns a throw into UNAVAILABLE, which BLOCKS. A silently dropped line would read as
    // "no pull requests carried", which PASSES — the direction a guard must never fail in.
    expect(() => parseCommitSubjects('feat(x): raw, unencoded (#1)')).toThrow(/not JSON-encoded/);
  });

  it('is empty for empty output', () => {
    expect(parseCommitSubjects('')).toEqual([]);
    expect(parseCommitSubjects(undefined)).toEqual([]);
  });
});
