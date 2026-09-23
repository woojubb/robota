import { describe, expect, it } from 'vitest';

import {
  readLandingPull,
  selectAssociatedPull,
  selectLandingPull,
} from '../landing-pull-request.mjs';

const squashOid = 'a'.repeat(40);
const mergeOid = 'b'.repeat(40);

describe('selectLandingPull', () => {
  it('selects a merged pull request by exact base and merge commit without reading its subject', () => {
    expect(
      selectLandingPull({
        landingOid: squashOid,
        baseRefName: 'develop',
        pulls: [
          {
            number: 2806,
            state: 'closed',
            merged_at: '2026-09-21T00:00:00Z',
            base: { ref: 'develop' },
            merge_commit_sha: squashOid,
            title: 'docs(tasks): record the result',
            body: 'Closes #2798',
          },
        ],
      }),
    ).toEqual({
      number: 2806,
      baseRefName: 'develop',
      mergeCommit: { oid: squashOid },
      title: 'docs(tasks): record the result',
      body: 'Closes #2798',
    });
  });

  it('selects the same contract for a two-parent landing projection', () => {
    expect(
      selectLandingPull({
        landingOid: mergeOid,
        baseRefName: 'develop',
        pulls: [
          {
            number: 2805,
            state: 'MERGED',
            baseRefName: 'develop',
            mergeCommit: { oid: mergeOid },
            title: 'Merge pull request #2805 from woojubb/topic',
          },
        ],
      }),
    ).toMatchObject({
      number: 2805,
      baseRefName: 'develop',
      mergeCommit: { oid: mergeOid },
    });
  });

  it('rejects an exact OID when the receipt names a different pull request', () => {
    expect(() =>
      selectLandingPull({
        landingOid: squashOid,
        baseRefName: 'develop',
        pullNumber: 2805,
        pulls: [
          {
            number: 2806,
            state: 'closed',
            merged_at: '2026-09-21T00:00:00Z',
            base: { ref: 'develop' },
            merge_commit_sha: squashOid,
          },
        ],
      }),
    ).toThrow(/unavailable/);
  });

  it.each([
    [
      'unmerged',
      {
        number: 2805,
        state: 'open',
        merged_at: null,
        base: { ref: 'develop' },
        merge_commit_sha: squashOid,
      },
    ],
    [
      'wrong base',
      {
        number: 2805,
        state: 'closed',
        merged_at: '2026-09-21T00:00:00Z',
        base: { ref: 'main' },
        merge_commit_sha: squashOid,
      },
    ],
    [
      'wrong OID',
      {
        number: 2805,
        state: 'closed',
        merged_at: '2026-09-21T00:00:00Z',
        base: { ref: 'develop' },
        merge_commit_sha: 'b'.repeat(40),
      },
    ],
    [
      'malformed',
      {
        number: '2805',
        state: 'closed',
        merged_at: '2026-09-21T00:00:00Z',
        base: { ref: 'develop' },
        merge_commit_sha: squashOid,
      },
    ],
  ])('rejects an %s candidate', (_name, pull) => {
    expect(() =>
      selectLandingPull({
        landingOid: squashOid,
        baseRefName: 'develop',
        pulls: [pull],
      }),
    ).toThrow(/unavailable/);
  });

  it('rejects an ambiguous exact association', () => {
    const pull = {
      number: 2805,
      state: 'MERGED',
      baseRefName: 'develop',
      mergeCommit: { oid: squashOid },
    };
    expect(() =>
      selectLandingPull({
        landingOid: squashOid,
        baseRefName: 'develop',
        pulls: [pull, { ...pull, number: 2806 }],
      }),
    ).toThrow(/ambiguous \(2 matches\)/);
  });
});

describe('readLandingPull', () => {
  it('reads the complete commit association and returns its exact merged pull request', () => {
    const calls = [];
    const pull = readLandingPull({
      repository: 'woojubb/robota',
      landingOid: squashOid,
      baseRefName: 'develop',
      runGh: (args) => {
        calls.push(args);
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                number: 2806,
                state: 'closed',
                merged_at: '2026-09-21T00:00:00Z',
                base: { ref: 'develop' },
                merge_commit_sha: squashOid,
                title: 'docs(tasks): record the result',
                body: 'Closes #2798',
              },
            ],
          ]),
          stderr: '',
        };
      },
    });

    expect(pull.number).toBe(2806);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--paginate');
    expect(calls[0].join(' ')).toContain(`commits/${squashOid}/pulls`);
  });
});

describe('selectAssociatedPull', () => {
  it('accepts an earlier commit associated with a multi-commit rebase PR', () => {
    expect(
      selectAssociatedPull({
        landingOid: mergeOid,
        baseRefName: 'develop',
        pulls: [
          {
            number: 2807,
            state: 'closed',
            merged_at: '2026-09-22T00:00:00Z',
            base: { ref: 'develop' },
            merge_commit_sha: squashOid,
          },
        ],
      }),
    ).toMatchObject({ number: 2807, mergeCommit: { oid: squashOid } });
  });
});
